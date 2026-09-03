/* src/server.ts
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

import { Hono, type Context } from "hono";
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
  sharedWith,
  type Access,
} from "./access.ts";
import { clearRepoMetadata } from "./repometa.ts";
import { notifyRepoCreated, notifyRepoDeleted, notifyPush } from "./notify.ts";
import { getSettings, setDiscordWebhook, setPrefs } from "./settings.ts";
import {
  discordWebhookUrl,
  mirrorUrl,
  mirrorHost,
  MIRROR_KINDS,
  type MirrorKind,
} from "./urls.ts";
import {
  getStatuses,
  checkAllMirrors,
  needsCheck,
  markStale,
  dropMirrorStatusKind,
} from "./mirror.ts";
import {
  PROFILE_REPO,
  PROFILE_REPOS_PATH,
  isProfileRepo,
  headReadme,
  safeRef,
  refDir,
  refSlug,
  repoExists,
  initBareRepo,
  createRepo,
  trashRepo,
  listTrash,
  restoreFromTrash,
  purgeFromTrash,
  purgeExpired,
  purgeAllExpired,
  trashHasName,
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
  readLinks,
  setLinks,
  localMirrorRefs,
  type MirrorLink,
  type Readme,
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
import { FONT_ORIGIN } from "./styles/index.ts";

type Env = { Variables: { user: SessionUser | null } };
const app = new Hono<Env>({ strict: false });

const SITE_ORIGIN = new URL(config.baseUrl).origin;

const GIT_RPC = /\/(?:git-upload-pack|git-receive-pack)$/;

app.use("*", async (c, next) => {
  const session = readSession(getCookie(c, SESSION_COOKIE));
  c.set("user", session && "sub" in session ? currentUser(session) : null);
  await next();
});

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  `font-src 'self' ${FONT_ORIGIN}`,
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
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Frame-Options", "DENY");
  if (SITE_ORIGIN.startsWith("https://")) {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
});

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

app.get("/settings", (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/auth/login");
  return c.html(
    view.settingsPage({
      user,
      settings: getSettings(view.ownerOf(user)),
      saved: c.req.query("saved") ? "saved." : null,
    }),
  );
});

app.post("/settings/discord", async (c) => {
  const user = c.get("user");
  if (!user) return c.text("forbidden\n", 403);
  const owner = view.ownerOf(user);
  const form = await c.req.formData();
  const raw = String(form.get("url") ?? "").trim();

  if (!raw) {
    setDiscordWebhook(owner, null);
    return c.redirect("/settings?saved=1");
  }
  const url = discordWebhookUrl(raw);
  if (!url) {
    return c.html(
      view.messagePage({
        title: "not a discord webhook",
        message:
          "That doesn't look like a Discord webhook URL. It should start with " +
          "https://discord.com/api/webhooks/ — nothing else is accepted.",
        user,
      }),
      400,
    );
  }
  setDiscordWebhook(owner, url);
  return c.redirect("/settings?saved=1");
});

app.post("/settings/prefs", async (c) => {
  const user = c.get("user");
  if (!user) return c.text("forbidden\n", 403);
  const form = await c.req.formData();
  setPrefs(view.ownerOf(user), {
    defaultPrivate: form.get("default_private") != null,
    discordPrivate: form.get("discord_private") != null,
    mirrorAuto: form.get("mirror_auto") != null,
  });
  return c.redirect("/settings?saved=1");
});

app.get("/settings/tokens", (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/auth/login");
  const owner = view.ownerOf(user);
  return c.html(view.tokensPage({ tokens: listTokens(owner), user }));
});

app.post("/settings/tokens", async (c) => {
  const user = c.get("user");
  if (!user) return c.text("forbidden\n", 403);
  const owner = view.ownerOf(user);
  const form = await c.req.formData();
  const plaintext = createToken(String(form.get("label") ?? ""), owner, user.sub);
  return c.html(
    view.tokensPage({ tokens: listTokens(owner), user, newToken: plaintext }),
  );
});

app.post("/settings/tokens/:id/revoke", (c) => {
  const user = c.get("user");
  if (!user) return c.text("forbidden\n", 403);
  revokeToken(c.req.param("id"), view.ownerOf(user));
  return c.redirect("/settings/tokens");
});

app.get("/tokens", (c) => c.redirect("/settings/tokens", 301));

app.get("/settings/deleted", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/auth/login");
  const owner = view.ownerOf(user);

  for (const gone of await purgeExpired(owner)) {
    clearRepoMetadata({ owner, name: gone.name });
    console.log(`[trash] purged ${owner}/${gone.name} past retention`);
  }

  return c.html(
    view.deletedPage({
      user,
      entries: await listTrash(owner),
      retentionDays: config.trashDays,
    }),
  );
});

app.post("/settings/deleted/restore", async (c) => {
  const user = c.get("user");
  if (!user) return c.text("forbidden\n", 403);
  const owner = view.ownerOf(user);
  const form = await c.req.formData();

  const result = await restoreFromTrash(owner, String(form.get("entry") ?? ""));
  if (!result.ok || !result.meta) {
    return c.html(
      view.messagePage({
        title: "could not restore",
        message: result.error ?? "unknown error",
        user,
      }),
      400,
    );
  }

  const ref = { owner, name: result.meta.name };
  for (const grant of result.meta.grants) {
    if (!isLevel(grant.level)) continue;
    if (!findUserBySlug(grant.slug)) {
      console.warn(
        `[trash] restoring ${refSlug(ref)}: dropping grant for unknown user ${grant.slug}`,
      );
      continue;
    }
    setCollaborator(ref, grant.slug, grant.level);
  }

  console.log(`[trash] restored ${refSlug(ref)}`);
  return c.redirect(`/${ref.owner}/${ref.name}/`);
});

app.post("/settings/deleted/purge", async (c) => {
  const user = c.get("user");
  if (!user) return c.text("forbidden\n", 403);
  const owner = view.ownerOf(user);
  const form = await c.req.formData();
  const entry = String(form.get("entry") ?? "");

  const found = (await listTrash(owner)).find((e) => e.entry === entry);
  if (await purgeFromTrash(owner, entry)) {
    if (found) clearRepoMetadata({ owner, name: found.name });
    console.log(`[trash] purged ${owner}/${found?.name ?? entry}`);
  }
  return c.redirect("/settings/deleted");
});

app.post("/new", async (c) => {
  const user = c.get("user");
  if (!user) return c.text("forbidden\n", 403);
  const form = await c.req.formData();
  const owner = view.ownerOf(user);
  const result = await createRepo(owner, String(form.get("name") ?? ""));
  if (!result.ok || !result.ref) {
    return c.html(
      view.messagePage({
        title: result.reserved ? "that name is still reserved" : "could not create repo",
        message: result.error ?? "unknown error",
        user,
      }),
      result.reserved ? 409 : 400,
    );
  }
  clearRepoMetadata(result.ref);
  const startsPublic = !getSettings(owner).defaultPrivate;
  if (startsPublic) {
    await setRepoPublic(result.ref, true);
  }
  notifyRepoCreated(result.ref, owner, startsPublic);
  return c.redirect(`/${result.ref.owner}/${result.ref.name}/`);
});

function refFromPath(c: Context<Env>, nameParam: "name" | "repo"): RepoRef | null {
  const owner = c.req.param("owner");
  const name = c.req.param(nameParam);
  if (!owner || !name) return null;
  return safeRef(owner, name);
}

const GIT_SERVICES: GitService[] = ["git-upload-pack", "git-receive-pack"];

function authChallenge(message = "authentication required"): Response {
  return new Response(`${message}\n`, {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="dough-git"' },
  });
}

interface GitGate {
  response: Response | null;
  actor: string | null;
}

const ALLOW = (actor: string | null): GitGate => ({ response: null, actor });
const DENY = (response: Response): GitGate => ({ response, actor: null });

async function gitGate(
  c: { req: { header: (n: string) => string | undefined } },
  ref: RepoRef,
  needPush: boolean,
): Promise<GitGate> {
  const auth = authenticateGit(c.req.header("authorization"));
  const actor = gitActor(auth);
  const exists = await repoExists(ref);

  if (auth.kind === "rejected") {
    console.warn(`[git] denied ${refSlug(ref)}: ${auth.message}`);
    return DENY(new Response(`${auth.message}\n`, { status: 403 }));
  }

  if (needPush) {
    if (!actor) return DENY(authChallenge());

    if (!exists) {
      if (actor !== ref.owner) {
        console.warn(`[git] denied create of ${refSlug(ref)} by ${actor}`);
        return DENY(
          new Response(`${actor} can only create repositories under ${actor}/\n`, {
            status: 403,
          }),
        );
      }
      if (await trashHasName(ref.owner, ref.name)) {
        console.warn(`[git] refused auto-create of trashed ${refSlug(ref)}`);
        return DENY(
          new Response(
            `${refSlug(ref)} is in Recently Deleted. Restore it, or delete it ` +
              `permanently, before pushing to that name again.\n`,
            { status: 409 },
          ),
        );
      }
      if (!config.autoCreate) {
        return DENY(new Response("repository not found\n", { status: 404 }));
      }
      await initBareRepo(ref);
      clearRepoMetadata(ref);
      console.log(`[git] auto-created ${refSlug(ref)}.git on first push`);
      notifyRepoCreated(ref, actor, false);
      return ALLOW(actor);
    }

    const isPublic = await isRepoPublic(ref);
    if (!canWrite({ ref, isPublic, viewer: actor })) {
      console.warn(`[git] denied push to ${refSlug(ref)} by ${actor}`);
      return DENY(
        new Response(`${actor} does not have write access to ${refSlug(ref)}\n`, {
          status: 403,
        }),
      );
    }
    return ALLOW(actor);
  }

  if (exists) {
    const isPublic = await isRepoPublic(ref);
    if (canRead({ ref, isPublic, viewer: actor })) return ALLOW(actor);
  }
  if (auth.kind === "anonymous") return DENY(authChallenge());
  return DENY(new Response("repository not found\n", { status: 404 }));
}

app.get("/:owner/:repo/info/refs", async (c) => {
  const ref = safeRef(c.req.param("owner"), c.req.param("repo"));
  const service = c.req.query("service") as GitService | undefined;
  if (!ref || !service || !GIT_SERVICES.includes(service)) {
    return c.text("only smart HTTP is supported\n", 400);
  }
  const gate = await gitGate(c, ref, service === "git-receive-pack");
  if (gate.response) return gate.response;
  return advertiseResponse(refDir(ref), service);
});

async function rpcHandler(c: Context<Env>, service: GitService): Promise<Response> {
  const ref = refFromPath(c, "repo");
  if (!ref) return c.text("bad repo\n", 400);
  const gate = await gitGate(c, ref, service === "git-receive-pack");
  if (gate.response) return gate.response;

  const isPush = service === "git-receive-pack";
  const before = isPush ? await localMirrorRefs(ref) : new Map<string, string>();
  const actor = gate.actor;
  const isPublic = isPush ? await isRepoPublic(ref) : false;

  return serviceRpc({
    repoDir: refDir(ref),
    service,
    body: c.req.raw.body,
    gzip: c.req.header("content-encoding") === "gzip",
    onDone: isPush
      ? (code) => {
          if (code !== 0) {
            console.warn(`[git] receive-pack for ${refSlug(ref)} exited ${code}`);
            return;
          }
          void (async () => {
            try {
              const after = await localMirrorRefs(ref);
              markStale(ref);
              notifyPush(ref, actor ?? "unknown", isPublic, before, after);
            } catch (err) {
              console.warn(`[git] post-push processing failed for ${refSlug(ref)}:`, err);
            }
          })();
        }
      : undefined,
  });
}

app.post("/:owner/:repo/git-upload-pack", (c) => rpcHandler(c, "git-upload-pack"));
app.post("/:owner/:repo/git-receive-pack", (c) => rpcHandler(c, "git-receive-pack"));

function viewerOf(c: { get: (k: "user") => SessionUser | null }): string | null {
  const user = c.get("user");
  return user ? view.ownerOf(user) : null;
}

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
  const all = (await listRepos()).filter((r) => !isProfileRepo(r.name));
  const shared = viewer ? new Set(sharedWith(viewer).map((r) => `${r.owner}/${r.name}`)) : null;
  return c.html(
    view.repoListPage(readable(all, viewer), user, {
      sharedSlugs: shared,
    }),
  );
});

function notFound(c: Context<Env>) {
  return c.html(
    view.messagePage({
      title: "not found",
      message: "No such repository, or you don't have access.",
      user: c.get("user"),
    }),
    404,
  );
}

interface ViewableRepo {
  ref: RepoRef;
  isPublic: boolean;
  access: Access;
  refs: RefList;
  rev: string;
}

async function viewable(c: Context<Env>): Promise<ViewableRepo | null> {
  const ref = refFromPath(c, "name");
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

async function renderTree(c: Context<Env>, path: string) {
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

async function ownedRef(c: Context<Env>): Promise<RepoRef | null> {
  const user = c.get("user");
  if (!user) return null;
  const ref = refFromPath(c, "name");
  if (!ref || ref.owner !== view.ownerOf(user)) return null;
  return (await repoExists(ref)) ? ref : null;
}

async function writableRef(c: Context<Env>): Promise<RepoRef | null> {
  const ref = refFromPath(c, "name");
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
  const user = c.get("user")!;
  const wasPublic = await isRepoPublic(ref);

  const result = await trashRepo(ref, {
    deletedAt: Math.floor(Date.now() / 1000),
    deletedBy: view.ownerOf(user),
    grants: listCollaborators(ref).map((g) => ({
      slug: g.slug,
      level: g.level,
    })),
  });
  if (!result.ok) {
    return c.html(
      view.messagePage({
        title: "could not delete",
        message: result.error ?? "unknown error",
        user,
      }),
      400,
    );
  }

  clearRepoMetadata(ref);
  notifyRepoDeleted(ref, view.ownerOf(user), wasPublic);
  return c.redirect("/settings/deleted");
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

async function profileReadme(
  owner: string,
  viewer: string | null,
): Promise<Readme | null> {
  const ref = safeRef(owner, PROFILE_REPO);
  if (!ref || !(await repoExists(ref))) return null;
  const isPublic = await isRepoPublic(ref);
  if (!canRead({ ref, isPublic, viewer })) return null;
  return headReadme(ref);
}

function ownedRepos(all: RepoSummary[], owner: string): RepoSummary[] {
  return all.filter((r) => r.owner === owner && !isProfileRepo(r.name));
}

app.get("/:owner", async (c) => {
  const owner = c.req.param("owner");
  if (!safeRef(owner, "x")) return notFound(c);

  const user = c.get("user");
  const viewer = viewerOf(c);
  const all = await listRepos();
  const owned = all.filter((r) => r.owner === owner);
  const repos = readable(ownedRepos(all, owner), viewer);
  const profile = findUserBySlug(owner);

  if (!profile && owned.length === 0) return notFound(c);

  return c.html(
    view.profilePage({
      owner,
      profile,
      repos,
      readme: await profileReadme(owner, viewer),
      hasProfileRepo: owned.some((r) => isProfileRepo(r.name)),
      isOwn: viewer === owner,
      user,
    }),
  );
});

app.get(`/:owner/${PROFILE_REPOS_PATH}`, async (c) => {
  const owner = c.req.param("owner");
  if (!safeRef(owner, "x")) return notFound(c);

  const viewer = viewerOf(c);
  const all = await listRepos();
  const profile = findUserBySlug(owner);
  if (!profile && !all.some((r) => r.owner === owner)) return notFound(c);

  return c.html(
    view.reposPage({
      owner,
      profile,
      repos: readable(ownedRepos(all, owner), viewer),
      user: c.get("user"),
    }),
  );
});

app.get("/:owner/:name", async (c) => {
  if (c.req.param("name") === PROFILE_REPOS_PATH) {
    return c.redirect(`/${c.req.param("owner")}/${PROFILE_REPOS_PATH}`, 301);
  }

  const found = await viewable(c);
  if (!found) return notFound(c);
  const { ref, isPublic, access, refs, rev } = found;

  const [commits, desc, links] = await Promise.all([
    log(ref, rev, 1),
    description(ref),
    readLinks(ref),
  ]);
  const readmeFile = commits.length ? await readme(ref, rev) : null;

  const user = c.get("user");
  const isOwner = user != null && view.ownerOf(user) === ref.owner;
  const canPush = access === "write";

  const statuses = getStatuses(ref);
  let localSha: string | null = null;
  if (links.length > 0) {
    const localRefs = await localMirrorRefs(ref);
    localSha = localRefs.get(`refs/heads/${refs.head}`) ?? null;

    if (canPush && getSettings(ref.owner).mirrorAuto) {
      const due = links.filter((l) => !l.isPrivate && needsCheck(statuses.get(l.kind)));
      if (due.length > 0) {
        void checkAllMirrors(ref, due).catch((err) => {
          console.warn(`[mirror] background check failed for ${refSlug(ref)}:`, err);
        });
      }
    }
  }

  return c.html(
    view.summaryPage({
      ...ref,
      isPublic,
      empty: refs.branches.length === 0,
      readme: readmeFile,
      rawDescription: desc,
      description: view.repoDescription({
        ...ref,
        description: desc,
        readme: readmeFile,
      }),
      canPush,
      collaborators: isOwner ? listCollaborators(ref) : null,
      links,
      mirrorStatuses: statuses,
      localSha,
      refs,
      rev,
      user,
    }),
  );
});

app.post("/:owner/:name/mirrors", async (c) => {
  const ref = await ownedRef(c);
  if (!ref) return notFound(c);
  const form = await c.req.formData();

  const links: MirrorLink[] = [];
  const rejected: string[] = [];
  for (const kind of MIRROR_KINDS) {
    const raw = String(form.get(kind) ?? "").trim();
    if (!raw) continue;
    const url = mirrorUrl(kind, raw);
    if (!url) {
      rejected.push(kind);
      continue;
    }
    links.push({
      kind,
      url,
      isPrivate: form.get(`${kind}_private`) != null,
    });
  }

  if (rejected.length > 0) {
    return c.html(
      view.messagePage({
        title: "that isn't a mirror URL",
        message:
          `The ${rejected.join(" and ")} link was refused. A mirror must be an ` +
          `https URL of the form https://${mirrorHost(rejected[0] as MirrorKind)}/owner/repo ` +
          `— no other host, no credentials, no port.`,
        user: c.get("user"),
      }),
      400,
    );
  }

  const before = await readLinks(ref);
  await setLinks(ref, links);
  for (const old of before) {
    const still = links.find((l) => l.kind === old.kind && l.url === old.url);
    if (!still) dropMirrorStatusKind(ref, old.kind);
  }
  return c.redirect(`/${ref.owner}/${ref.name}/`);
});

app.post("/:owner/:name/mirrors/check", async (c) => {
  const ref = await writableRef(c);
  if (!ref) return notFound(c);
  const links = await readLinks(ref);
  await checkAllMirrors(ref, links);
  return c.redirect(`/${ref.owner}/${ref.name}/`);
});

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function sweepTrash(): Promise<void> {
  try {
    const purged = await purgeAllExpired();
    for (const gone of purged) {
      clearRepoMetadata({ owner: gone.owner, name: gone.name });
      console.log(`[trash] expired ${gone.owner}/${gone.name}`);
    }
  } catch (err) {
    console.warn("[trash] scheduled sweep failed:", err);
  }
}

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
    console.log(
      `  trash:      ${config.trashDays > 0 ? `${config.trashDays}d, swept every 6h` : "kept forever"}`,
    );
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

    void sweepTrash();
    setInterval(() => void sweepTrash(), SWEEP_INTERVAL_MS).unref();
  },
);
