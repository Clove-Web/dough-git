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
  authenticateGit,
  canPushTo,
  type SessionUser,
} from "./auth.ts";
import { listTokens, createToken, revokeToken } from "./tokens.ts";
import { findUserBySlug } from "./users.ts";
import {
  safeRef,
  refDir,
  refSlug,
  repoExists,
  initBareRepo,
  createRepo,
  deleteRepo,
  isRepoPublic,
  setRepoPublic,
  listRepos,
  log,
  tree,
  blob,
  commit,
  readme,
  description,
  type RepoRef,
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

  // Behind the reverse proxy, c.req.url carries the internal host
  // (127.0.0.1:4010). The OIDC token exchange must use the SAME redirect_uri we
  // sent in the auth request, so rebuild the callback URL from the public base
  // URL, preserving the query (code, state, iss).
  const currentUrl = `${config.baseUrl}/auth/callback${new URL(c.req.url).search}`;

  let user = null;
  try {
    user = await finishLogin(currentUrl, tx);
  } catch (err) {
    const e = err as {
      error?: string;
      error_description?: string;
      message?: string;
    };
    console.error(
      "[auth] callback failed:",
      e?.error ? `error=${e.error}` : "",
      e?.error_description ? `desc=${e.error_description}` : "",
      err instanceof Error ? e.message : err,
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

// ---- token management (login required) --------------------------------------

app.get("/tokens", (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/auth/login");
  const owner = view.ownerOf(user);
  return c.html(view.tokensPage({ tokens: listTokens(owner), user }));
});

app.post("/tokens", async (c) => {
  const user = c.get("user");
  if (!user) return c.text("forbidden\n", 403);
  const owner = view.ownerOf(user);
  const form = await c.req.formData();
  const plaintext = createToken(String(form.get("label") ?? ""), owner, user.sub);
  return c.html(
    view.tokensPage({ tokens: listTokens(owner), user, newToken: plaintext }),
  );
});

app.post("/tokens/:id/revoke", (c) => {
  const user = c.get("user");
  if (!user) return c.text("forbidden\n", 403);
  revokeToken(c.req.param("id"), view.ownerOf(user));
  return c.redirect("/tokens");
});

// ---- repo creation (login required) -----------------------------------------
// Repos are always created under the logged-in user's own username.

app.post("/new", async (c) => {
  const user = c.get("user");
  if (!user) return c.text("forbidden\n", 403);
  const form = await c.req.formData();
  const owner = view.ownerOf(user);
  const result = await createRepo(owner, String(form.get("name") ?? ""));
  if (!result.ok || !result.ref) {
    return c.html(
      view.messagePage({
        title: "could not create repo",
        message: result.error ?? "unknown error",
        user,
      }),
      400,
    );
  }
  return c.redirect(`/${result.ref.owner}/${result.ref.name}/`);
});

// ---- git smart HTTP ---------------------------------------------------------

const GIT_SERVICES: GitService[] = ["git-upload-pack", "git-receive-pack"];

function authChallenge(message = "authentication required"): Response {
  return new Response(`${message}\n`, {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="dough-git"' },
  });
}

// Returns null when access is allowed, otherwise a short-circuit Response.
// Auth is checked BEFORE existence so a valid push token can auto-create a
// missing repo (and a missing private repo prompts rather than 404s).
async function gitGate(
  c: { req: { header: (n: string) => string | undefined } },
  ref: RepoRef,
  needPush: boolean,
): Promise<Response | null> {
  const auth = authenticateGit(c.req.header("authorization"));
  const exists = await repoExists(ref);

  // Bad credentials are a dead end, not a retry: re-prompting just loops the
  // credential helper past the same wrong username.
  if (auth.kind === "rejected") {
    console.warn(`[git] denied ${refSlug(ref)}: ${auth.message}`);
    return new Response(`${auth.message}\n`, { status: 403 });
  }

  if (needPush) {
    if (auth.kind === "anonymous") return authChallenge();
    if (!canPushTo(auth, ref.owner)) {
      const who = auth.kind === "user" ? auth.owner : "this token";
      console.warn(
        `[git] denied push to ${refSlug(ref)} by ${who} (not their namespace)`,
      );
      return new Response(
        `${who} can only push to repositories under ${
          auth.kind === "user" ? `${auth.owner}/` : "its own namespace"
        }\n`,
        { status: 403 },
      );
    }
    if (!exists) {
      if (!config.autoCreate) {
        return new Response("repository not found\n", { status: 404 });
      }
      await initBareRepo(ref);
      console.log(`[git] auto-created ${refSlug(ref)}.git on first push`);
    }
    return null;
  }

  if (!exists) return new Response("repository not found\n", { status: 404 });
  if (await isRepoPublic(ref)) return null;
  // Reads of a private repo stay open to any valid token, matching what a
  // signed-in browser can already see on this instance.
  if (auth.kind === "anonymous") return authChallenge();
  return null;
}

app.get("/:owner/:repo/info/refs", async (c) => {
  const ref = safeRef(c.req.param("owner"), c.req.param("repo"));
  const service = c.req.query("service") as GitService | undefined;
  if (!ref || !service || !GIT_SERVICES.includes(service)) {
    return c.text("only smart HTTP is supported\n", 400);
  }
  const gate = await gitGate(c, ref, service === "git-receive-pack");
  if (gate) return gate;
  return advertiseResponse(refDir(ref), service);
});

async function rpcHandler(c: any, service: GitService): Promise<Response> {
  const ref = safeRef(c.req.param("owner"), c.req.param("repo"));
  if (!ref) return c.text("bad repo\n", 400);
  const gate = await gitGate(c, ref, service === "git-receive-pack");
  if (gate) return gate;
  return serviceRpc({
    repoDir: refDir(ref),
    service,
    body: c.req.raw.body,
    gzip: c.req.header("content-encoding") === "gzip",
  });
}

app.post("/:owner/:repo/git-upload-pack", (c) => rpcHandler(c, "git-upload-pack"));
app.post("/:owner/:repo/git-receive-pack", (c) => rpcHandler(c, "git-receive-pack"));

// ---- viewer -----------------------------------------------------------------

app.get("/", async (c) => {
  const user = c.get("user");
  const all = await listRepos();
  const visible = user ? all : all.filter((r) => r.isPublic);
  return c.html(view.repoListPage(visible, user));
});

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

// Resolve owner/name params to a viewable RepoRef, or null (render 404).
async function viewable(c: any): Promise<RepoRef | null> {
  const ref = safeRef(c.req.param("owner"), c.req.param("name"));
  if (!ref || !(await repoExists(ref))) return null;
  if (await isRepoPublic(ref)) return ref;
  return c.get("user") ? ref : null;
}

app.get("/:owner/:name/log", async (c) => {
  const ref = await viewable(c);
  if (!ref) return notFound(c);
  const commits = await log(ref, "HEAD", 100);
  return c.html(view.logPage({ ...ref, commits, user: c.get("user") }));
});

app.get("/:owner/:name/tree", (c) => renderTree(c, ""));
app.get("/:owner/:name/tree/:path{.*}", (c) => renderTree(c, c.req.param("path")));

async function renderTree(c: any, path: string) {
  const ref = await viewable(c);
  if (!ref) return notFound(c);
  const entries = await tree(ref, "HEAD", path);
  return c.html(view.treePage({ ...ref, path, entries, user: c.get("user") }));
}

app.get("/:owner/:name/blob/:path{.*}", async (c) => {
  const ref = await viewable(c);
  if (!ref) return notFound(c);
  const path = c.req.param("path");
  const b = await blob(ref, "HEAD", path);
  if (!b) return notFound(c);
  return c.html(
    view.blobPage({ ...ref, path, binary: b.binary, text: b.text, user: c.get("user") }),
  );
});

app.get("/:owner/:name/commit/:sha", async (c) => {
  const ref = await viewable(c);
  if (!ref) return notFound(c);
  const detail = await commit(ref, c.req.param("sha"));
  if (!detail) return notFound(c);
  return c.html(view.commitPage({ ...ref, commit: detail, user: c.get("user") }));
});

// Resolve params for a management action: the repo must exist and belong to the
// caller. Same rule the git transport applies to a push.
async function ownedRef(c: any): Promise<RepoRef | null> {
  const user = c.get("user");
  if (!user) return null;
  const ref = safeRef(c.req.param("owner"), c.req.param("name"));
  if (!ref || ref.owner !== view.ownerOf(user)) return null;
  return (await repoExists(ref)) ? ref : null;
}

app.post("/:owner/:name/visibility", async (c) => {
  const ref = await ownedRef(c);
  if (!ref) return notFound(c);
  const form = await c.req.formData();
  await setRepoPublic(ref, form.get("public") === "on");
  return c.redirect(`/${ref.owner}/${ref.name}/`);
});

app.post("/:owner/:name/delete", async (c) => {
  const ref = await ownedRef(c);
  if (!ref) return notFound(c);
  await deleteRepo(ref);
  return c.redirect("/");
});

// Profile page. Registered before the two-segment repo routes only for
// readability — they differ in path length, so they can't collide.
app.get("/:owner", async (c) => {
  const owner = c.req.param("owner");
  if (!safeRef(owner, "x")) return notFound(c);

  const user = c.get("user");
  const all = await listRepos();
  const owned = all.filter((r) => r.owner === owner);
  const repos = user ? owned : owned.filter((r) => r.isPublic);
  const profile = findUserBySlug(owner);

  // Nobody by that name, and nothing of theirs to show.
  if (!profile && owned.length === 0) return notFound(c);
  return c.html(view.profilePage({ owner, profile, repos, user }));
});

app.get("/:owner/:name", async (c) => {
  const ref = await viewable(c);
  if (!ref) return notFound(c);
  const [commits, isPublic, desc] = await Promise.all([
    log(ref, "HEAD", 1),
    isRepoPublic(ref),
    description(ref),
  ]);
  // An empty repo has no tree to search, so skip the README lookup entirely.
  const readmeFile = commits.length ? await readme(ref, "HEAD") : null;
  return c.html(
    view.summaryPage({
      ...ref,
      isPublic,
      empty: commits.length === 0,
      readme: readmeFile,
      description: view.repoDescription({ ...ref, description: desc, readme: readmeFile }),
      user: c.get("user"),
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
