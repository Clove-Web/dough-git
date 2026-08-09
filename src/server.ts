// HTTP entrypoint: wires the git smart-HTTP transport and the read-only viewer
// onto one Hono app. Run with `bun run src/server.ts`.

import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { serve } from "@hono/node-server";
import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";
import { config, oidcEnabled } from "./config.ts";
import {
  SESSION_COOKIE,
  OAUTH_COOKIE,
  readSession,
  makeSessionCookie,
  startLogin,
  finishLogin,
  oidcIssuer,
  parseBasicAuth,
  isValidGitToken,
  type SessionUser,
} from "./auth.ts";
import {
  safeRepoName,
  repoDir,
  repoExists,
  isRepoPublic,
  setRepoPublic,
  listRepos,
  log,
  tree,
  blob,
  commit,
} from "./git.ts";
import {
  advertiseResponse,
  serviceRpc,
  type GitService,
} from "./smart-http.ts";
import * as view from "./views.ts";

type Env = { Variables: { user: SessionUser | null } };
const app = new Hono<Env>({ strict: false });

// Attach the logged-in user (if any) to every request.
app.use("*", async (c, next) => {
  const user = readSession(getCookie(c, SESSION_COOKIE));
  c.set("user", user && "sub" in user ? user : null);
  await next();
});

// ---- static files (bring your own style.css) --------------------------------

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

app.get("/static/*", (c) => {
  const rel = c.req.path.replace(/^\/static\//, "");
  if (rel.includes("..")) return c.notFound();
  const full = join(config.staticDir, rel);
  if (!existsSync(full) || !statSync(full).isFile()) return c.notFound();
  const ext = full.slice(full.lastIndexOf("."));
  const stream = Readable.toWeb(
    createReadStream(full),
  ) as unknown as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
    },
  });
});

// ---- auth -------------------------------------------------------------------

app.get("/auth/login", async (c) => {
  if (!oidcEnabled) {
    return c.html(
      view.messagePage({
        title: "login unavailable",
        message: "PocketID (OIDC) is not configured on this instance.",
        user: null,
      }),
      501,
    );
  }
  const { redirectUrl, txCookie } = await startLogin();
  setCookie(c, OAUTH_COOKIE, txCookie, {
    httpOnly: true,
    secure: config.baseUrl.startsWith("https"),
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  });
  return c.redirect(redirectUrl);
});

app.get("/auth/callback", async (c) => {
  const tx = getCookie(c, OAUTH_COOKIE);
  deleteCookie(c, OAUTH_COOKIE, { path: "/" });

  // If PocketID redirected back with an error, surface it directly.
  const idpError = c.req.query("error");
  if (idpError) {
    console.error(
      `[auth] provider returned error=${idpError} ${c.req.query("error_description") ?? ""}`,
    );
  }
  if (!tx) {
    console.error(
      "[auth] no oauth transaction cookie on callback — likely a cookie issue " +
        "(MINIGIT_BASE_URL scheme vs how you're actually reaching the site, or a " +
        "host mismatch between /auth/login and /auth/callback).",
    );
  }

  let user = null;
  try {
    user = await finishLogin(c.req.url, tx);
  } catch (err) {
    console.error(
      "[auth] callback failed:",
      err instanceof Error ? (err.stack ?? err.message) : err,
    );
  }
  if (!user) {
    return c.html(
      view.messagePage({
        title: "login failed",
        message: "Could not complete sign-in, or your account is not allowed.",
        user: null,
      }),
      403,
    );
  }
  setCookie(c, SESSION_COOKIE, makeSessionCookie(user), {
    httpOnly: true,
    secure: config.baseUrl.startsWith("https"),
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return c.redirect("/");
});

app.get("/auth/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.redirect("/");
});

// ---- git smart HTTP ---------------------------------------------------------

const GIT_SERVICES: GitService[] = ["git-upload-pack", "git-receive-pack"];

// Returns null when access is allowed, otherwise a short-circuit Response.
async function gitGate(
  c: { req: { header: (n: string) => string | undefined } },
  name: string,
  needPush: boolean,
): Promise<Response | null> {
  if (!(await repoExists(name))) {
    return new Response("repository not found\n", { status: 404 });
  }
  const basic = parseBasicAuth(c.req.header("authorization"));
  const hasToken = Boolean(basic && isValidGitToken(basic[1]));

  if (needPush) {
    if (hasToken) return null;
  } else {
    if (await isRepoPublic(name)) return null;
    if (hasToken) return null;
  }
  return new Response("authentication required\n", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="dough-git"' },
  });
}

app.get("/:repo/info/refs", async (c) => {
  const repo = c.req.param("repo");
  const clean = safeRepoName(repo);
  const service = c.req.query("service") as GitService | undefined;
  if (!clean || !service || !GIT_SERVICES.includes(service)) {
    return c.text("only smart HTTP is supported\n", 400);
  }
  const name = clean.replace(/\.git$/, "");
  const gate = await gitGate(c, name, service === "git-receive-pack");
  if (gate) return gate;
  return advertiseResponse(repoDir(name)!, service);
});

async function rpcHandler(c: any, service: GitService): Promise<Response> {
  const clean = safeRepoName(c.req.param("repo"));
  if (!clean) return c.text("bad repo\n", 400);
  const name = clean.replace(/\.git$/, "");
  const gate = await gitGate(c, name, service === "git-receive-pack");
  if (gate) return gate;
  return serviceRpc({
    repoDir: repoDir(name)!,
    service,
    body: c.req.raw.body,
    gzip: c.req.header("content-encoding") === "gzip",
  });
}

app.post("/:repo/git-upload-pack", (c) => rpcHandler(c, "git-upload-pack"));
app.post("/:repo/git-receive-pack", (c) => rpcHandler(c, "git-receive-pack"));

// ---- viewer -----------------------------------------------------------------

app.get("/", async (c) => {
  const user = c.get("user");
  const all = await listRepos();
  // Hide private repos from anonymous visitors.
  const visible = user ? all : all.filter((r) => r.isPublic);
  return c.html(view.repoListPage(visible, user));
});

// Guard a viewer request: null return means "render 404".
async function canView(
  name: string,
  user: SessionUser | null,
): Promise<boolean> {
  if (!(await repoExists(name))) return false;
  if (await isRepoPublic(name)) return true;
  return Boolean(user);
}

function notFound(c: any) {
  return c.html(
    view.messagePage({
      title: "not found",
      message: "No such repository, or you don't have access.",
      user: c.get("user"),
    }),
    404,
  );
}

app.get("/:name/log", async (c) => {
  const user = c.get("user");
  const name = c.req.param("name");
  if (!(await canView(name, user))) return notFound(c);
  const commits = await log(name, "HEAD", 100);
  return c.html(view.logPage({ name, commits, user }));
});

app.get("/:name/tree", async (c) => renderTree(c, ""));
app.get("/:name/tree/:path{.*}", async (c) => renderTree(c, c.req.param("path")));

async function renderTree(c: any, path: string) {
  const user = c.get("user");
  const name = c.req.param("name");
  if (!(await canView(name, user))) return notFound(c);
  const entries = await tree(name, "HEAD", path);
  return c.html(view.treePage({ name, path, entries, user }));
}

app.get("/:name/blob/:path{.*}", async (c) => {
  const user = c.get("user");
  const name = c.req.param("name");
  const path = c.req.param("path");
  if (!(await canView(name, user))) return notFound(c);
  const b = await blob(name, "HEAD", path);
  if (!b) return notFound(c);
  return c.html(
    view.blobPage({ name, path, binary: b.binary, text: b.text, user }),
  );
});

app.get("/:name/commit/:sha", async (c) => {
  const user = c.get("user");
  const name = c.req.param("name");
  if (!(await canView(name, user))) return notFound(c);
  const detail = await commit(name, c.req.param("sha"));
  if (!detail) return notFound(c);
  return c.html(view.commitPage({ name, commit: detail, user }));
});

// Toggle visibility (owner action; requires a logged-in, allowed user).
app.post("/:name/visibility", async (c) => {
  const user = c.get("user");
  if (!user) return c.text("forbidden\n", 403);
  const name = c.req.param("name");
  if (!(await repoExists(name))) return notFound(c);
  const form = await c.req.formData();
  await setRepoPublic(name, form.get("public") === "on");
  return c.redirect(`/${name}/`);
});

app.get("/:name", async (c) => {
  const user = c.get("user");
  const name = c.req.param("name");
  if (!(await canView(name, user))) return notFound(c);
  const [commits, isPublic] = await Promise.all([
    log(name, "HEAD", 20),
    isRepoPublic(name),
  ]);
  return c.html(
    view.summaryPage({
      name,
      description: "",
      isPublic,
      branch: "HEAD",
      commits,
      user,
    }),
  );
});

// ---- boot -------------------------------------------------------------------

serve(
  {
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  },
  async () => {
    console.log(`dough-git listening on http://${config.host}:${config.port}`);
    console.log(`  repos root: ${config.reposRoot}`);
    console.log(`  static dir: ${config.staticDir}`);
    console.log(`  base url:   ${config.baseUrl}`);
    console.log(`  oidc:       ${oidcEnabled ? "enabled" : "disabled"}`);
    console.log(`  git tokens: ${config.gitTokens.length} configured`);
    if (oidcEnabled) {
      try {
        const iss = await oidcIssuer();
        console.log(`  oidc issuer (must equal the callback's iss): ${iss}`);
        console.log(`  oidc redirect_uri: ${config.baseUrl}/auth/callback`);
      } catch (err) {
        console.error(
          "  oidc discovery FAILED (check OIDC_ISSUER):",
          err instanceof Error ? err.message : err,
        );
      }
    }
  },
);
