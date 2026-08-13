// HTML rendering. Class names come from the compiled Vanilla Extract styles
// (src/styles). Repos are addressed GitHub-style as owner/name throughout.

import { config } from "./config.ts";
import { classes as c } from "./styles/index.ts";
import { escapeHtml, renderMarkdown, plainSummary } from "./markdown.ts";
import { sessionSlug } from "./auth.ts";
import type { SessionUser } from "./auth.ts";
import type { TokenRow } from "./tokens.ts";
import type { UserRow } from "./users.ts";
import type {
  RepoSummary,
  Commit,
  TreeEntry,
  CommitDetail,
  Readme,
} from "./git.ts";

export const esc = escapeHtml;

function fmtDate(unix: number | null): string {
  if (!unix) return "";
  return new Date(unix * 1000).toISOString().slice(0, 16).replace("T", " ");
}

// owner/name base path (URL-safe by construction — validated in git.ts).
function base(owner: string, name: string): string {
  return `/${esc(owner)}/${esc(name)}`;
}

function cloneUrl(owner: string, name: string): string {
  return `${config.baseUrl}/${owner}/${name}.git`;
}

// Collapse a description to one clean line of attribute-safe text.
function metaText(s: string, max = 200): string {
  const flat = s.replace(/\s+/g, " ").trim();
  const clipped =
    flat.length > max ? flat.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : flat;
  return esc(clipped);
}

// The shared shape of "a person" across sessions and directory rows.
interface Profile {
  name: string | null;
  username: string | null;
  picture: string | null;
}

export function displayName(p: Profile & { sub?: string }): string {
  return p.name ?? p.username ?? p.sub ?? "user";
}

// Avatar from PocketID's `picture` claim, over a first-initial fallback. The
// IDP may serve avatars only to signed-in browsers, so a failed image drops
// itself and uncovers the initial rather than leaving a broken-image box.
function avatar(p: Profile, size: number): string {
  const initial = esc(displayName(p).trim().slice(0, 1).toUpperCase() || "?");
  const box = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.5)}px`;
  const img = p.picture
    ? `<img class="${c.avatarImg}" src="${esc(p.picture)}" alt="" loading="lazy" onerror="this.remove()">`
    : "";
  return `<span class="${c.avatar}" style="${box}">${initial}${img}</span>`;
}

function layout(opts: {
  title: string;
  user: SessionUser | null;
  body: string;
  // Page description for <meta description> / social previews.
  description?: string;
  // Site-absolute path of this page, for canonical + og:url.
  path?: string;
  // Private repos and account pages shouldn't end up in search results.
  noindex?: boolean;
}): string {
  // Three zones: home on the left, who you are in the middle, settings right.
  const whoami = opts.user
    ? `<a class="${c.user}" href="/${esc(ownerOf(opts.user))}">${avatar(opts.user, 22)}${esc(displayName(opts.user))}</a>`
    : "";
  const settings = opts.user
    ? `<a class="${c.navLink}" href="/tokens">tokens</a>
       <a class="${c.navLink}" href="/auth/logout">logout</a>`
    : `<a class="${c.navLink}" href="/auth/login">login</a>`;

  const description = metaText(opts.description || config.description);
  const url = opts.path ? esc(config.baseUrl + opts.path) : esc(config.baseUrl);
  const icon = esc(config.favicon);
  // Same image as the favicon, doubling as the header mark. Decorative: the
  // title text right next to it already names the site.
  const logo = config.favicon
    ? `<img class="${c.siteLogo}" src="${icon}" alt="" width="24" height="24">`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(opts.title)}</title>
  <meta name="description" content="${description}">
  <meta name="theme-color" content="${esc(config.themeColor)}">
  <meta name="generator" content="dough-git">
  ${opts.noindex ? `<meta name="robots" content="noindex, nofollow">` : `<link rel="canonical" href="${url}">`}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(config.title)}">
  <meta property="og:title" content="${esc(opts.title)}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${icon}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${esc(opts.title)}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${icon}">
  <link rel="icon" href="${icon}">
  <link rel="apple-touch-icon" href="${icon}">
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
  <header class="${c.siteHeader}">
    <a class="${c.siteTitle}" href="/">${logo}${esc(config.title)}</a>
    <div class="${c.siteWho}">${whoami}</div>
    <nav class="${c.siteNav}">${settings}</nav>
  </header>
  <main class="${c.content}">
${opts.body}
  </main>
  <footer class="${c.siteFooter}">
    <span>dough-git &middot; a minimal git mirror</span>
  </footer>
</body>
</html>`;
}

// The repo table shared by the front page and the profile pages. `showOwner`
// is off on a profile, where every row has the same owner as the heading.
function repoTable(
  repos: RepoSummary[],
  opts: { showOwner: boolean; empty: string },
): string {
  const rows = repos
    .map((r) => {
      const owner = opts.showOwner
        ? `<a class="${c.ownerLink}" href="/${esc(r.owner)}">${esc(r.owner)}</a>/`
        : "";
      return `      <tr class="${c.repoRow}">
        <td class="${c.repoName}">${owner}<a href="${base(r.owner, r.name)}/">${esc(r.name)}</a></td>
        <td class="${c.repoDesc}">${esc(r.description)}</td>
        <td class="${c.repoVis}">${r.isPublic ? "public" : "private"}</td>
        <td class="${c.repoIdle}">${fmtDate(r.lastCommit)}</td>
      </tr>`;
    })
    .join("\n");

  return `<table class="${c.repoList}">
      <thead>
        <tr><th>repository</th><th>description</th><th>visibility</th><th>updated</th></tr>
      </thead>
      <tbody>
${rows || `        <tr><td colspan="4" class="${c.empty}">${esc(opts.empty)}</td></tr>`}
      </tbody>
    </table>`;
}

export function repoListPage(
  repos: RepoSummary[],
  user: SessionUser | null,
): string {
  const createForm = user
    ? `    <form method="post" action="/new" class="${c.cloneBox}">
      <label class="${c.cloneLabel}">new repo</label>
      <span class="${c.repoVis}">${esc(ownerOf(user))}/</span>
      <input type="text" name="name" placeholder="my-project" pattern="[A-Za-z0-9._-]+" required>
      <button type="submit">create</button>
    </form>`
    : "";

  const body = `    <h1 class="${c.pageTitle}">repositories</h1>
${createForm}
    ${repoTable(repos, { showOwner: true, empty: "no repositories visible" })}`;
  return layout({ title: config.title, user, body, path: "/" });
}

// A deliberately small profile: who this is, and what they own. Anything more
// (activity feeds, bios, follower counts) is a different kind of site.
export function profilePage(opts: {
  owner: string;
  profile: UserRow | null;
  repos: RepoSummary[];
  user: SessionUser | null;
}): string {
  const p = opts.profile;
  const name = p ? displayName(p) : opts.owner;
  // The slug is the handle; only mention the upstream username when it says
  // something the slug doesn't (a rename, or characters the slug dropped).
  const handle = p?.username && p.username !== p.slug ? p.username : null;

  const known = p
    ? `<p class="${c.repoDesc}">@${esc(p.slug)}${handle ? ` &middot; ${esc(handle)}` : ""} &middot; joined ${fmtDate(p.created_at).slice(0, 10)}</p>`
    // Repos can outlive their account (or arrive by push before anyone logs
    // in), so an owner directory with no user row still gets a page.
    : `<p class="${c.repoDesc}">@${esc(opts.owner)} &middot; no account on this instance</p>`;

  const body = `    <section class="${c.profileHead}">
      ${avatar(p ?? { name: opts.owner, username: null, picture: null }, 64)}
      <div>
        <h1 class="${c.profileName}">${esc(name)}</h1>
        ${known}
      </div>
    </section>
    <h2 class="${c.sectionTitle}">repositories</h2>
    ${repoTable(opts.repos, { showOwner: false, empty: "nothing here yet" })}`;

  return layout({
    title: name,
    user: opts.user,
    body,
    description: `${name} (@${opts.owner}) on ${config.title}.`,
    path: `/${opts.owner}`,
    // Someone with nothing public shouldn't be indexed into existence by their
    // presence on a mostly-private instance.
    noindex: !opts.repos.some((r) => r.isPublic),
  });
}

// The owner segment this user's repos live under. Assigned once at first login
// and carried in the session; see users.ts for why it can't be re-derived.
export function ownerOf(user: SessionUser): string {
  return sessionSlug(user);
}

function repoNav(owner: string, name: string, active: string): string {
  const b = base(owner, name);
  const tab = (id: string, label: string, href: string) =>
    `<a class="${c.tab}${id === active ? " " + c.tabActive : ""}" href="${href}">${label}</a>`;
  return `    <nav class="${c.repoTabs}">
      ${tab("summary", "summary", `${b}/`)}
      ${tab("log", "log", `${b}/log`)}
      ${tab("tree", "tree", `${b}/tree`)}
    </nav>`;
}

function commitTable(owner: string, name: string, commits: Commit[]): string {
  const b = base(owner, name);
  const rows = commits
    .map(
      (cm) => `      <tr>
        <td class="${c.commitDate}">${fmtDate(cm.time)}</td>
        <td class="${c.commitSubject}"><a href="${b}/commit/${esc(cm.hash)}">${esc(cm.subject)}</a></td>
        <td class="${c.commitAuthor}">${esc(cm.author)}</td>
        <td class="${c.commitHash}">${esc(cm.hash.slice(0, 10))}</td>
      </tr>`,
    )
    .join("\n");
  return `<table class="${c.commitList}">
      <tbody>
${rows || `        <tr><td class="${c.empty}">no commits</td></tr>`}
      </tbody>
    </table>`;
}

export function summaryPage(opts: {
  owner: string;
  name: string;
  isPublic: boolean;
  empty: boolean;
  readme: Readme | null;
  description: string;
  user: SessionUser | null;
}): string {
  const title = `${opts.owner}/${opts.name}`;
  const empty = opts.empty;
  const pushHint = empty
    ? `    <section class="${c.cloneBox}">
      <p><strong>This repository is empty.</strong> Push to get started:</p>
      <code>git remote add mirror ${esc(cloneUrl(opts.owner, opts.name))}<br>git push --mirror mirror</code>
      <p class="${c.repoDesc}">When prompted, the <strong>username</strong> is <code>${esc(opts.owner)}</code> and the <strong>password</strong> is a token from <a href="/tokens">/tokens</a>.</p>
    </section>`
    : "";

  // An empty repo has nothing to look for, so it only gets the push hint above.
  const readmeSection = empty
    ? ""
    : opts.readme
      ? `    <h2 class="${c.sectionTitle}">${esc(opts.readme.path)}</h2>
    <article class="${c.readme}">
${renderMarkdown(opts.readme.text)}
    </article>`
      : `    <h2 class="${c.sectionTitle}">readme</h2>
    <p class="${c.empty}">No ReadMe was found, commit one to add a summary</p>`;

  // Only the owner manages a repo — matching what the git transport enforces.
  const manage = opts.user && ownerOf(opts.user) === opts.owner
    ? `    <h2 class="${c.sectionTitle}">manage</h2>
    <div class="${c.repoTabs}">
      <form method="post" action="${base(opts.owner, opts.name)}/visibility">
        <input type="hidden" name="public" value="${opts.isPublic ? "" : "on"}">
        <button type="submit">make ${opts.isPublic ? "private" : "public"}</button>
      </form>
      <form method="post" action="${base(opts.owner, opts.name)}/delete" onsubmit="return confirm('Delete ${esc(title)} permanently? This cannot be undone.');">
        <button type="submit">delete repository</button>
      </form>
    </div>`
    : "";

  const body = `    <h1 class="${c.pageTitle}"><a class="${c.ownerLink}" href="/${esc(opts.owner)}">${esc(opts.owner)}</a>/${esc(opts.name)}</h1>
    <p class="${c.repoDesc}">${opts.isPublic ? "public" : "private"}</p>
${repoNav(opts.owner, opts.name, "summary")}
    <section class="${c.cloneBox}">
      <span class="${c.cloneLabel}">clone</span>
      <code>git clone ${esc(cloneUrl(opts.owner, opts.name))}</code>
    </section>
${pushHint}
${readmeSection}
${manage}`;
  return layout({
    title,
    user: opts.user,
    body,
    description: opts.description,
    path: `/${opts.owner}/${opts.name}`,
    noindex: !opts.isPublic,
  });
}

// Best available one-line description of a repo: git's own `description` file,
// else the opening prose of the README, else a generic line.
export function repoDescription(opts: {
  owner: string;
  name: string;
  description: string;
  readme: Readme | null;
}): string {
  if (opts.description.trim()) return opts.description;
  const fromReadme = opts.readme ? plainSummary(opts.readme.text) : "";
  if (fromReadme) return fromReadme;
  return `${opts.owner}/${opts.name} — a git repository on ${config.title}.`;
}

export function logPage(opts: {
  owner: string;
  name: string;
  commits: Commit[];
  user: SessionUser | null;
}): string {
  const title = `${opts.owner}/${opts.name}`;
  const body = `    <h1 class="${c.pageTitle}">${esc(title)} &middot; log</h1>
${repoNav(opts.owner, opts.name, "log")}
    ${commitTable(opts.owner, opts.name, opts.commits)}`;
  return layout({
    title: `${title} log`,
    user: opts.user,
    body,
    description: `Commit history for ${title}.`,
    path: `/${opts.owner}/${opts.name}/log`,
  });
}

export function treePage(opts: {
  owner: string;
  name: string;
  path: string;
  entries: TreeEntry[];
  user: SessionUser | null;
}): string {
  const b = base(opts.owner, opts.name);
  const crumb = opts.path ? ` /${esc(opts.path)}` : "";
  const rows = opts.entries
    .map((e) => {
      const childPath = opts.path ? `${opts.path}/${e.name}` : e.name;
      const href =
        e.type === "tree" ? `${b}/tree/${esc(childPath)}` : `${b}/blob/${esc(childPath)}`;
      return `      <tr class="${c.repoRow}">
        <td class="${c.treeMode}">${esc(e.mode)}</td>
        <td class="${c.treeName}"><a href="${href}">${esc(e.name)}${e.type === "tree" ? "/" : ""}</a></td>
        <td class="${c.treeSize}">${esc(e.size)}</td>
      </tr>`;
    })
    .join("\n");

  const body = `    <h1 class="${c.pageTitle}">${esc(opts.owner)}/${esc(opts.name)} &middot; tree${crumb}</h1>
${repoNav(opts.owner, opts.name, "tree")}
    <table class="${c.treeList}">
      <tbody>
${rows || `        <tr><td class="${c.empty}">empty</td></tr>`}
      </tbody>
    </table>`;
  return layout({
    title: `${opts.owner}/${opts.name} tree`,
    user: opts.user,
    body,
    description: `Files in ${opts.owner}/${opts.name}${opts.path ? ` at ${opts.path}` : ""}.`,
    path: `${b}/tree${opts.path ? `/${opts.path}` : ""}`,
  });
}

export function blobPage(opts: {
  owner: string;
  name: string;
  path: string;
  binary: boolean;
  text: string;
  user: SessionUser | null;
}): string {
  const content = opts.binary
    ? `<p class="${c.binaryNotice}">binary file not shown</p>`
    : `<pre class="${c.code}"><code>${esc(opts.text)}</code></pre>`;
  const body = `    <h1 class="${c.pageTitle}">${esc(opts.owner)}/${esc(opts.name)} &middot; ${esc(opts.path)}</h1>
${repoNav(opts.owner, opts.name, "tree")}
    ${content}`;
  return layout({
    title: opts.path,
    user: opts.user,
    body,
    description: `${opts.path} in ${opts.owner}/${opts.name}.`,
    path: `${base(opts.owner, opts.name)}/blob/${opts.path}`,
  });
}

export function commitPage(opts: {
  owner: string;
  name: string;
  commit: CommitDetail;
  user: SessionUser | null;
}): string {
  const cm = opts.commit;
  const body = `    <h1 class="${c.pageTitle}">${esc(cm.subject)}</h1>
${repoNav(opts.owner, opts.name, "log")}
    <dl class="${c.commitMeta}">
      <dt>commit</dt><dd class="${c.commitHash}">${esc(cm.hash)}</dd>
      <dt>author</dt><dd>${esc(cm.author)} &lt;${esc(cm.email)}&gt;</dd>
      <dt>date</dt><dd>${fmtDate(cm.time)}</dd>
    </dl>
    ${cm.body ? `<pre class="${c.code}">${esc(cm.body)}</pre>` : ""}
    <pre class="${c.code}"><code>${esc(cm.diff)}</code></pre>`;
  return layout({
    title: cm.subject,
    user: opts.user,
    body,
    description: `${cm.subject} — ${cm.author} in ${opts.owner}/${opts.name}.`,
    path: `${base(opts.owner, opts.name)}/commit/${cm.hash}`,
  });
}

export function tokensPage(opts: {
  tokens: TokenRow[];
  user: SessionUser | null;
  newToken?: string | null;
}): string {
  const rows = opts.tokens
    .map(
      (t) => `      <tr>
        <td>${esc(t.label)}</td>
        <td class="${c.commitHash}">${esc(t.id)}</td>
        <td class="${c.commitDate}">${fmtDate(t.created_at)}</td>
        <td class="${c.commitDate}">${t.last_used ? fmtDate(t.last_used) : "never"}</td>
        <td>
          <form method="post" action="/tokens/${esc(t.id)}/revoke">
            <button type="submit">revoke</button>
          </form>
        </td>
      </tr>`,
    )
    .join("\n");

  const authUser = opts.user ? ownerOf(opts.user) : "git";
  const created = opts.newToken
    ? `    <section class="${c.cloneBox}">
      <p><strong>New token — copy it now, it won't be shown again:</strong></p>
      <code>${esc(opts.newToken)}</code>
      <p class="${c.repoDesc}">Ready-to-use remote:<br>
      <code>git remote add mirror ${esc(config.baseUrl.replace("://", `://${authUser}:${opts.newToken}@`))}/${esc(authUser)}/&lt;repo&gt;.git</code></p>
    </section>`
    : "";

  const body = `    <h1 class="${c.pageTitle}">access tokens</h1>
    <p class="${c.repoDesc}">These tokens act as <code>${esc(authUser)}</code>: use that as the git
    <strong>username</strong> and the token as the <strong>password</strong>. They can only push to
    repositories under <code>${esc(authUser)}/</code>.</p>
${created}
    <form method="post" action="/tokens" class="${c.cloneBox}">
      <label class="${c.cloneLabel}">label</label>
      <input type="text" name="label" placeholder="laptop, backup cron, ...">
      <button type="submit">create token</button>
    </form>
    <table>
      <thead>
        <tr><th>label</th><th>id</th><th>created</th><th>last used</th><th></th></tr>
      </thead>
      <tbody>
${rows || `        <tr><td colspan="5" class="${c.empty}">no tokens yet</td></tr>`}
      </tbody>
    </table>`;
  return layout({
    title: "access tokens",
    user: opts.user,
    body,
    description: "Manage git access tokens.",
    noindex: true,
  });
}

export function messagePage(opts: {
  title: string;
  message: string;
  user: SessionUser | null;
  status?: number;
}): string {
  const body = `    <h1 class="${c.pageTitle}">${esc(opts.title)}</h1>
    <p class="${c.message}">${esc(opts.message)}</p>`;
  return layout({
    title: opts.title,
    user: opts.user,
    body,
    description: opts.message,
    noindex: true,
  });
}
