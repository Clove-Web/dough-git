/* src/server.ts */
//
// HTTP entrypoint: wires the git smart-HTTP transport and the read-only viewer
// onto one Hono app. Run with `npm start`.

import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { serve } from "@hono/node-server";
import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { join, resolve, sep } from "node:path";
import { config, oidcEnabled } from "./config.ts";
import {
  SESSION_COOKIE,
  OAUTH_COOKIE,
  readSession,
  currentUser,
  makeSessionCookie,
  startLogin,
  finishLogin,
  oidcIssuer,
  authenticateGit,
  gitActor,
  type SessionUser,
} from "./auth.ts";
import { listTokens, createToken, revokeToken } from "./tokens.ts";
import { findUserBySlug } from "./users.ts";
import {
  accessFor,
  canRead,
  canWrite,
  isLevel,
  listCollaborators,
  setCollaborator,
  removeCollaborator,
  dropRepoAccess,
  sharedWith,
  type Access,
} from "./access.ts";
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
  listRefs,
  resolveRev,
  log,
  tree,
  blob,
  commit,
  readme,
  description,
  setDescription,
  type RepoRef,
  type RepoSummary,
  type RefList,
} from "./git.ts";
import {
  advertiseResponse,
  serviceRpc,
  type GitService,
} from "./smart-http.ts";
import * as view from "./views.ts";

type Env = { Variables: { user: SessionUser | null } };
const app = new Hono<Env>({ strict: false });

const SITE_ORIGIN = new URL(config.baseUrl).origin;

// The git transport authenticates with a token on every request and never with
// a cookie, so the browser-only protections below skip it.
const GIT_RPC = /\/(?:git-upload-pack|git-receive-pack)$/;

// Attach the logged-in user (if any) to every request.
//
// The cookie is signed and self-contained, so it stays valid for its full 30
// days no matter what happens upstream. Re-anchoring it on the user directory
// each request is what makes removing an account take effect now rather than a
// month from now.
app.use("*", async (c, next) => {
  const session = readSession(getCookie(c, SESSION_COOKIE));
  c.set("user", session && "sub" in session ? currentUser(session) : null);
  await next();
});

// ---- response hardening -----------------------------------------------------

// README content is attacker-controlled and rendered into these pages, so the
// CSP is the backstop behind markdown.ts: no inline script, no plugins, and no
// framing. Images are left open because READMEs legitimately hotlink badges.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

app.use("*", async (c, next) => {
  await next();
  if (GIT_RPC.test(c.req.path) || c.req.path.endsWith("/info/refs")) return;
  c.header("Content-Security-Policy", CSP);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  if (SITE_ORIGIN.startsWith("https://")) {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
});

// ---- CSRF -------------------------------------------------------------------

// Every state-changing form here is authorised by the session cookie alone, so
// a cross-site POST would otherwise act as the signed-in user. SameSite=Lax
// already blocks the common case; this closes the rest, and costs one header
// comparison. A browser always sends Origin on POST, so a missing one is not a
// browser form and has nothing to lose.
function sameOrigin(origin: string | undefined, referer: string | undefined): boolean {
  if (origin) return origin === SITE_ORIGIN;
  if (referer) {
    try {
      return new URL(referer).origin === SITE_ORIGIN;
    } catch {
      return false;
    }
  }
  return false;
}

app.use("*", async (c, next) => {
  const method = c.req.method;
  const unsafe = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (unsafe && !GIT_RPC.test(c.req.path)) {
    if (!sameOrigin(c.req.header("origin"), c.req.header("referer"))) {
      return c.text("cross-site request refused\n", 403);
    }
  }
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

const STATIC_ROOT = resolve(config.staticDir);

app.get("/static/*", (c) => {
  // Decode before checking: a `..` that arrives percent-encoded is still a
  // `..` by the time the filesystem sees it. Resolve, then prove the result is
  // still inside the static root rather than trusting the pattern match.
  let rel: string;
  try {
    rel = decodeURIComponent(c.req.path.replace(/^\/static\//, ""));
  } catch {
    return c.notFound();
  }
  if (rel.includes("\0")) return c.notFound();

  const full = resolve(join(STATIC_ROOT, rel));
  if (full !== STATIC_ROOT && !full.startsWith(STATIC_ROOT + sep)) {
    return c.notFound();
  }
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
  const actor = gitActor(auth);
  const exists = await repoExists(ref);

  // Bad credentials are a dead end, not a retry: re-prompting just loops the
  // credential helper past the same wrong username.
  if (auth.kind === "rejected") {
    console.warn(`[git] denied ${refSlug(ref)}: ${auth.message}`);
    return new Response(`${auth.message}\n`, { status: 403 });
  }

  if (needPush) {
    if (!actor) return authChallenge();

    // A repo that doesn't exist yet has no collaborators, so the only person
    // who can bring it into being is the owner of the namespace it names.
    if (!exists) {
      if (actor !== ref.owner) {
        console.warn(`[git] denied create of ${refSlug(ref)} by ${actor}`);
        return new Response(
          `${actor} can only create repositories under ${actor}/\n`,
          { status: 403 },
        );
      }
      if (!config.autoCreate) {
        return new Response("repository not found\n", { status: 404 });
      }
      await initBareRepo(ref);
      console.log(`[git] auto-created ${refSlug(ref)}.git on first push`);
      return null;
    }

    const isPublic = await isRepoPublic(ref);
    if (!canWrite({ ref, isPublic, viewer: actor })) {
      console.warn(`[git] denied push to ${refSlug(ref)} by ${actor}`);
      return new Response(
        `${actor} does not have write access to ${refSlug(ref)}\n`,
        { status: 403 },
      );
    }
    return null;
  }

  // Reads. A private repo must not confirm its own existence to somebody with
  // no access, so "no access" and "no such repo" give the same 404.
  if (exists) {
    const isPublic = await isRepoPublic(ref);
    if (canRead({ ref, isPublic, viewer: actor })) return null;
  }
  // Prompt for credentials if none were offered — the repo may well be theirs.
  if (auth.kind === "anonymous") return authChallenge();
  return new Response("repository not found\n", { status: 404 });
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

// The owner slug of whoever is browsing, or null when nobody is signed in.
function viewerOf(c: { get: (k: "user") => SessionUser | null }): string | null {
  const user = c.get("user");
  return user ? view.ownerOf(user) : null;
}

// Filter a repo listing down to what this viewer may see. Public repos are in
// for everybody; private ones only for their owner and invited collaborators.
function readable(all: RepoSummary[], viewer: string | null): RepoSummary[] {
  return all.filter((r) =>
    canRead({
      ref: { owner: r.owner, name: r.name },
      isPublic: r.isPublic,
      viewer,
    }),
  );
}

app.get("/", async (c) => {
  const user = c.get("user");
  const viewer = viewerOf(c);
  const all = await listRepos();
  const shared = viewer ? new Set(sharedWith(viewer).map((r) => `${r.owner}/${r.name}`)) : null;
  return c.html(
    view.repoListPage(readable(all, viewer), user, {
      sharedSlugs: shared,
    }),
  );
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

// A repo the caller may look at, with what they may do to it. Null means 404 —
// including when the repo exists but isn't theirs to know about.
//
// `rev` is the revision being viewed, taken from `?h=` and resolved against the
// refs this repo actually has. It is never the raw query value, so it is safe
// to pass to git.
interface ViewableRepo {
  ref: RepoRef;
  isPublic: boolean;
  access: Access;
  refs: RefList;
  rev: string;
}

async function viewable(c: any): Promise<ViewableRepo | null> {
  const ref = safeRef(c.req.param("owner"), c.req.param("name"));
  if (!ref || !(await repoExists(ref))) return null;

  const isPublic = await isRepoPublic(ref);
  const access = accessFor({ ref, isPublic, viewer: viewerOf(c) });
  if (access === "none") return null;

  const refs = await listRefs(ref);
  const rev = await resolveRev(ref, c.req.query("h"), refs);
  return { ref, isPublic, access, refs, rev };
}

app.get("/:owner/:name/log", async (c) => {
  const found = await viewable(c);
  if (!found) return notFound(c);
  const commits = await log(found.ref, found.rev, 100);
  return c.html(
    view.logPage({
      ...found.ref,
      commits,
      refs: found.refs,
      rev: found.rev,
      user: c.get("user"),
    }),
  );
});

app.get("/:owner/:name/tree", (c) => renderTree(c, ""));
app.get("/:owner/:name/tree/:path{.*}", (c) => renderTree(c, c.req.param("path")));

async function renderTree(c: any, path: string) {
  const found = await viewable(c);
  if (!found) return notFound(c);
  const entries = await tree(found.ref, found.rev, path);
  return c.html(
    view.treePage({
      ...found.ref,
      path,
      entries,
      refs: found.refs,
      rev: found.rev,
      user: c.get("user"),
    }),
  );
}

app.get("/:owner/:name/blob/:path{.*}", async (c) => {
  const found = await viewable(c);
  if (!found) return notFound(c);
  const path = c.req.param("path");
  const b = await blob(found.ref, found.rev, path);
  if (!b) return notFound(c);
  return c.html(
    view.blobPage({
      ...found.ref,
      path,
      binary: b.binary,
      text: b.text,
      truncated: b.truncated,
      bytes: b.bytes,
      refs: found.refs,
      rev: found.rev,
      user: c.get("user"),
    }),
  );
});

app.get("/:owner/:name/commit/:sha", async (c) => {
  const found = await viewable(c);
  if (!found) return notFound(c);
  // commit() refuses anything that isn't an object id, so a `--option` in the
  // URL lands here as a 404 rather than as an argument to git.
  const detail = await commit(found.ref, c.req.param("sha"));
  if (!detail) return notFound(c);
  return c.html(
    view.commitPage({
      ...found.ref,
      commit: detail,
      rev: found.rev,
      user: c.get("user"),
    }),
  );
});

// ---- repo management --------------------------------------------------------

// Resolve params for a management action. Visibility, deletion and the
// collaborator list are the owner's alone: a write collaborator can push, but
// cannot publish somebody else's repo or give away access to it.
async function ownedRef(c: any): Promise<RepoRef | null> {
  const user = c.get("user");
  if (!user) return null;
  const ref = safeRef(c.req.param("owner"), c.req.param("name"));
  if (!ref || ref.owner !== view.ownerOf(user)) return null;
  return (await repoExists(ref)) ? ref : null;
}

// The description is repo content rather than repo governance, so anyone who
// can push may edit it — the same people who could change it by committing.
async function writableRef(c: any): Promise<RepoRef | null> {
  const ref = safeRef(c.req.param("owner"), c.req.param("name"));
  if (!ref || !(await repoExists(ref))) return null;
  const isPublic = await isRepoPublic(ref);
  return canWrite({ ref, isPublic, viewer: viewerOf(c) }) ? ref : null;
}

app.post("/:owner/:name/description", async (c) => {
  const ref = await writableRef(c);
  if (!ref) return notFound(c);
  const form = await c.req.formData();
  await setDescription(ref, String(form.get("description") ?? ""));
  return c.redirect(`/${ref.owner}/${ref.name}/`);
});

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
  // Grants must not outlive the repo, or a rebuilt one of the same name would
  // silently come back shared.
  dropRepoAccess(ref);
  return c.redirect("/");
});

app.post("/:owner/:name/collaborators", async (c) => {
  const ref = await ownedRef(c);
  if (!ref) return notFound(c);

  const form = await c.req.formData();
  const slug = String(form.get("slug") ?? "").trim().toLowerCase();
  const levelRaw = String(form.get("level") ?? "read");
  const level = isLevel(levelRaw) ? levelRaw : "read";

  const invited = findUserBySlug(slug);
  if (!invited) {
    return c.html(
      view.messagePage({
        title: "no such user",
        message:
          `Nobody on this instance goes by "${slug}". They have to sign in ` +
          `with PocketID once before they can be added.`,
        user: c.get("user"),
      }),
      400,
    );
  }
  if (invited.slug === ref.owner) {
    return c.html(
      view.messagePage({
        title: "already the owner",
        message: "You can't add yourself as a collaborator on your own repo.",
        user: c.get("user"),
      }),
      400,
    );
  }

  setCollaborator(ref, invited.slug, level);
  return c.redirect(`/${ref.owner}/${ref.name}/`);
});

app.post("/:owner/:name/collaborators/remove", async (c) => {
  const ref = await ownedRef(c);
  if (!ref) return notFound(c);
  const form = await c.req.formData();
  removeCollaborator(ref, String(form.get("slug") ?? ""));
  return c.redirect(`/${ref.owner}/${ref.name}/`);
});

// Profile page. Registered before the two-segment repo routes only for
// readability — they differ in path length, so they can't collide.
app.get("/:owner", async (c) => {
  const owner = c.req.param("owner");
  if (!safeRef(owner, "x")) return notFound(c);

  const user = c.get("user");
  const viewer = viewerOf(c);
  const all = await listRepos();
  const owned = all.filter((r) => r.owner === owner);
  const repos = readable(owned, viewer);
  const profile = findUserBySlug(owner);

  // Nobody by that name, and nothing of theirs to show.
  if (!profile && owned.length === 0) return notFound(c);
  return c.html(view.profilePage({ owner, profile, repos, user }));
});

app.get("/:owner/:name", async (c) => {
  const found = await viewable(c);
  if (!found) return notFound(c);
  const { ref, isPublic, access, refs, rev } = found;

  const [commits, desc] = await Promise.all([
    log(ref, rev, 1),
    description(ref),
  ]);
  // An empty repo has no tree to search, so skip the README lookup entirely.
  const readmeFile = commits.length ? await readme(ref, rev) : null;

  const user = c.get("user");
  const isOwner = user != null && view.ownerOf(user) === ref.owner;

  return c.html(
    view.summaryPage({
      ...ref,
      isPublic,
      empty: refs.branches.length === 0,
      readme: readmeFile,
      // The raw `description` file, for the edit form. Empty means unset.
      rawDescription: desc,
      description: view.repoDescription({
        ...ref,
        description: desc,
        readme: readmeFile,
      }),
      canPush: access === "write",
      // Only the owner manages the grant list, so only they are shown it.
      collaborators: isOwner ? listCollaborators(ref) : null,
      refs,
      rev,
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
    console.log(`  logins:     any PocketID account`);
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
