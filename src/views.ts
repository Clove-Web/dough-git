/* src/views.ts */
//
// HTML rendering. Class names come from the compiled Vanilla Extract styles
// (src/styles). Repos are addressed GitHub-style as owner/name throughout.

import { config } from "./config.ts";
import { classes as c } from "./styles/index.ts";
import { escapeHtml, renderMarkdown, plainSummary } from "./markdown.ts";
import { sessionSlug } from "./auth.ts";
import type { SessionUser } from "./auth.ts";
import type { CollaboratorRow } from "./access.ts";
import type { TokenRow } from "./tokens.ts";
import type { UserRow } from "./users.ts";
import type {
  RepoSummary,
  Commit,
  TreeEntry,
  CommitDetail,
  Readme,
  RefList,
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

// ---- revisions --------------------------------------------------------------

// The `?h=` a link needs to stay on the current revision. The default branch
// carries no query, so ordinary URLs stay clean and shareable.
//
// A branch name may contain characters that are structural in a URL (`/` in
// `feature/thing`, `#`, `?`), so it is always percent-encoded — which also
// makes it safe to drop straight into an HTML attribute.
function revQuery(rev: string, head: string): string {
  return rev === head ? "" : `?h=${encodeURIComponent(rev)}`;
}

// A picker for the branch or tag being viewed. It is a plain GET form, so it
// works with scripting off; /static/app.js only removes the extra click.
function revPicker(refs: RefList, rev: string): string {
  const all = [...refs.branches, ...refs.tags];
  // Nothing to switch between, or a detached commit id that isn't in the list.
  if (all.length < 2 && all.includes(rev)) return "";
  if (all.length === 0) return "";

  const options = (names: string[], label: string): string => {
    if (names.length === 0) return "";
    const items = names
      .map(
        (name) =>
          `<option value="${esc(name)}"${name === rev ? " selected" : ""}>${esc(name)}</option>`,
      )
      .join("");
    return `<optgroup label="${label}">${items}</optgroup>`;
  };

  // A revision reached by object id isn't in either list; show it so the
  // control never displays something other than what is on screen.
  const detached = all.includes(rev)
    ? ""
    : `<option value="${esc(rev)}" selected>${esc(rev.slice(0, 10))}</option>`;

  return `<form method="get" class="${c.revPicker}">
      <label class="${c.cloneLabel}" for="rev-picker">revision</label>
      <select id="rev-picker" name="h" data-autosubmit>
        ${detached}${options(refs.branches, "branches")}${options(refs.tags, "tags")}
      </select>
      <button type="submit">go</button>
    </form>`;
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
//
// The drop is done by /static/app.js rather than an inline onerror handler,
// because the Content-Security-Policy forbids inline script — that policy is
// what stands behind markdown.ts if the renderer ever lets something through.
function avatar(p: Profile, size: number): string {
  const initial = esc(displayName(p).trim().slice(0, 1).toUpperCase() || "?");
  const box = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.5)}px`;
  const img = p.picture
    ? `<img class="${c.avatarImg}" src="${esc(p.picture)}" alt="" loading="lazy" data-avatar>`
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
    ? `<a class="${c.user}" href="/${esc(ownerOf(opts.user))}">${avatar(opts.user, 28)}${esc(displayName(opts.user))}</a>`
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
  <script src="/static/app.js" defer></script>
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
//
// `sharedSlugs` holds the `owner/name` of repos this viewer only sees because
// somebody invited them. Marking those is the difference between "my repos" and
// "repos I can reach", which is otherwise invisible.
function repoTable(
  repos: RepoSummary[],
  opts: {
    showOwner: boolean;
    empty: string;
    sharedSlugs?: Set<string> | null;
  },
): string {
  const rows = repos
    .map((r) => {
      const owner = opts.showOwner
        ? `<a class="${c.ownerLink}" href="/${esc(r.owner)}">${esc(r.owner)}</a>/`
        : "";
      const shared = opts.sharedSlugs?.has(`${r.owner}/${r.name}`)
        ? `<span class="${c.badge}">shared</span>`
        : "";
      return `      <tr class="${c.repoRow}">
        <td class="${c.repoName}">${owner}<a href="${base(r.owner, r.name)}/">${esc(r.name)}</a>${shared}</td>
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
  opts: { sharedSlugs?: Set<string> | null } = {},
): string {
  const createForm = user
    ? `    <form method="post" action="/new" class="${c.cloneBox} ${c.formRow}">
      <label class="${c.cloneLabel}">new repo</label>
      <span class="${c.repoVis}">${esc(ownerOf(user))}/</span>
      <input type="text" name="name" placeholder="my-project" pattern="[A-Za-z0-9._-]+" required>
      <button type="submit">create</button>
    </form>`
    : "";

  const body = `    <h1 class="${c.pageTitle}">repositories</h1>
${createForm}
    ${repoTable(repos, {
      showOwner: true,
      empty: "no repositories visible",
      sharedSlugs: opts.sharedSlugs,
    })}`;
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
      ${avatar(p ?? { name: opts.owner, username: null, picture: null }, 112)}
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

// The three repo tabs. `q` is the `?h=` suffix, so switching tabs keeps you on
// the branch you were reading.
function repoNav(
  owner: string,
  name: string,
  active: string,
  q: string,
): string {
  const b = base(owner, name);
  const tab = (id: string, label: string, href: string) =>
    `<a class="${c.tab}${id === active ? " " + c.tabActive : ""}" href="${href}">${label}</a>`;
  return `    <nav class="${c.repoTabs}">
      ${tab("summary", "summary", `${b}/${q}`)}
      ${tab("log", "log", `${b}/log${q}`)}
      ${tab("tree", "tree", `${b}/tree${q}`)}
    </nav>`;
}

function commitTable(
  owner: string,
  name: string,
  commits: Commit[],
  q: string,
): string {
  const b = base(owner, name);
  const rows = commits
    .map(
      (cm) => `      <tr>
        <td class="${c.commitDate}">${fmtDate(cm.time)}</td>
        <td class="${c.commitSubject}"><a href="${b}/commit/${esc(cm.hash)}${q}">${esc(cm.subject)}</a></td>
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
  // The `description` file as stored, for the edit form. "" means unset.
  rawDescription: string;
  // True when the viewer may push: the owner, or a write collaborator.
  canPush: boolean;
  // The grant list, but only when the viewer is the owner — nobody else is
  // shown who else has access.
  collaborators: CollaboratorRow[] | null;
  refs: RefList;
  rev: string;
  user: SessionUser | null;
}): string {
  const title = `${opts.owner}/${opts.name}`;
  const empty = opts.empty;
  const q = revQuery(opts.rev, opts.refs.head);
  // Whoever is pushing authenticates as themselves, not as the repo's owner, so
  // the username in the hint is the reader's own slug.
  const pusher = opts.user ? ownerOf(opts.user) : opts.owner;
  const pushHint =
    empty && opts.canPush
      ? `    <section class="${c.cloneBox}">
      <p><strong>This repository is empty.</strong> Push to get started:</p>
      <code>git remote add mirror ${esc(cloneUrl(opts.owner, opts.name))}<br>git push --mirror mirror</code>
      <p class="${c.repoDesc}">When prompted, the <strong>username</strong> is <code>${esc(pusher)}</code> and the <strong>password</strong> is a token from <a href="/tokens">/tokens</a>.</p>
    </section>`
      : empty
        ? `    <section class="${c.cloneBox}">
      <p class="${c.empty}">This repository is empty.</p>
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
  // A write collaborator can push, but can't publish the repo, delete it, or
  // hand access to anybody else.
  const isOwner = opts.collaborators !== null;
  const manage = isOwner
    ? `    <h2 class="${c.sectionTitle}">manage</h2>
    <div class="${c.repoTabs}">
      <form method="post" action="${base(opts.owner, opts.name)}/visibility">
        <input type="hidden" name="public" value="${opts.isPublic ? "" : "on"}">
        <button type="submit">make ${opts.isPublic ? "private" : "public"}</button>
      </form>
      <form method="post" action="${base(opts.owner, opts.name)}/delete" data-confirm="Delete ${esc(title)} permanently? This cannot be undone.">
        <button type="submit">delete repository</button>
      </form>
    </div>
${collaboratorSection(opts.owner, opts.name, opts.collaborators ?? [])}`
    : "";

  // Editing the blurb needs push rights, not ownership: it is the same thing a
  // collaborator could already change by committing a README.
  const descriptionForm = opts.canPush
    ? `    <form method="post" action="${base(opts.owner, opts.name)}/description" class="${c.cloneBox} ${c.formRow}">
      <label class="${c.cloneLabel}" for="repo-description">description</label>
      <input id="repo-description" class="${c.grow}" type="text" name="description" maxlength="300"
        value="${esc(opts.rawDescription)}" placeholder="what this repository is for">
      <button type="submit">save</button>
    </form>`
    : opts.rawDescription
      ? `    <p class="${c.repoDesc}">${esc(opts.rawDescription)}</p>`
      : "";

  const body = `    <h1 class="${c.pageTitle}"><a class="${c.ownerLink}" href="/${esc(opts.owner)}">${esc(opts.owner)}</a>/${esc(opts.name)}</h1>
    <p class="${c.repoDesc}">${opts.isPublic ? "public" : "private"}${opts.canPush && !isOwner ? `<span class="${c.badge}">you can push</span>` : ""}</p>
${repoNav(opts.owner, opts.name, "summary", q)}
${descriptionForm}
    ${revPicker(opts.refs, opts.rev)}
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

// The owner's view of who else can reach this repo. Read access is what makes a
// private repo visible at all; write access additionally allows a push.
function collaboratorSection(
  owner: string,
  name: string,
  collaborators: CollaboratorRow[],
): string {
  const action = `${base(owner, name)}/collaborators`;

  const rows = collaborators
    .map(
      (person) => `      <tr>
        <td><a href="/${esc(person.slug)}">${esc(person.slug)}</a></td>
        <td class="${c.repoVis}">${esc(person.level)}</td>
        <td class="${c.commitDate}">${fmtDate(person.added_at)}</td>
        <td>
          <form method="post" action="${action}/remove">
            <input type="hidden" name="slug" value="${esc(person.slug)}">
            <button type="submit">remove</button>
          </form>
        </td>
      </tr>`,
    )
    .join("\n");

  return `    <h2 class="${c.sectionTitle}">collaborators</h2>
    <p class="${c.repoDesc}">People here can see this repository even while it is
    private. <code>write</code> also lets them push to it.</p>
    <form method="post" action="${action}" class="${c.cloneBox} ${c.formRow}">
      <label class="${c.cloneLabel}" for="collab-slug">username</label>
      <input id="collab-slug" type="text" name="slug" placeholder="their handle" pattern="[A-Za-z0-9._-]+" required>
      <select name="level" aria-label="access level">
        <option value="read">read</option>
        <option value="write">write</option>
      </select>
      <button type="submit">add</button>
    </form>
    <table>
      <thead>
        <tr><th>user</th><th>access</th><th>added</th><th></th></tr>
      </thead>
      <tbody>
${rows || `        <tr><td colspan="4" class="${c.empty}">nobody else has access</td></tr>`}
      </tbody>
    </table>`;
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
  refs: RefList;
  rev: string;
  user: SessionUser | null;
}): string {
  const title = `${opts.owner}/${opts.name}`;
  const q = revQuery(opts.rev, opts.refs.head);
  const body = `    <h1 class="${c.pageTitle}">${esc(title)} &middot; log</h1>
${repoNav(opts.owner, opts.name, "log", q)}
    ${revPicker(opts.refs, opts.rev)}
    ${commitTable(opts.owner, opts.name, opts.commits, q)}`;
  return layout({
    title: `${title} log`,
    user: opts.user,
    body,
    description: `Commit history for ${title} on ${opts.rev}.`,
    path: `/${opts.owner}/${opts.name}/log`,
  });
}

export function treePage(opts: {
  owner: string;
  name: string;
  path: string;
  entries: TreeEntry[];
  refs: RefList;
  rev: string;
  user: SessionUser | null;
}): string {
  const b = base(opts.owner, opts.name);
  const q = revQuery(opts.rev, opts.refs.head);
  const crumb = opts.path ? ` /${esc(opts.path)}` : "";

  // A link back up one level, so a deep tree isn't a dead end without the
  // browser's back button.
  const parent = opts.path
    ? `      <tr class="${c.repoRow}">
        <td class="${c.treeMode}"></td>
        <td class="${c.treeName}"><a href="${b}/tree/${esc(opts.path.split("/").slice(0, -1).join("/"))}${q}">../</a></td>
        <td class="${c.treeSize}"></td>
      </tr>`
    : "";

  const rows = opts.entries
    .map((e) => {
      const childPath = opts.path ? `${opts.path}/${e.name}` : e.name;
      const href =
        e.type === "tree"
          ? `${b}/tree/${esc(childPath)}${q}`
          : `${b}/blob/${esc(childPath)}${q}`;
      return `      <tr class="${c.repoRow}">
        <td class="${c.treeMode}">${esc(e.mode)}</td>
        <td class="${c.treeName}"><a href="${href}">${esc(e.name)}${e.type === "tree" ? "/" : ""}</a></td>
        <td class="${c.treeSize}">${esc(e.size)}</td>
      </tr>`;
    })
    .join("\n");

  const body = `    <h1 class="${c.pageTitle}">${esc(opts.owner)}/${esc(opts.name)} &middot; tree${crumb}</h1>
${repoNav(opts.owner, opts.name, "tree", q)}
    ${revPicker(opts.refs, opts.rev)}
    <table class="${c.treeList}">
      <tbody>
${[parent, rows].filter(Boolean).join("\n") || `        <tr><td class="${c.empty}">empty</td></tr>`}
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

// Bytes as something a person can read at a glance.
function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function blobPage(opts: {
  owner: string;
  name: string;
  path: string;
  binary: boolean;
  text: string;
  truncated: boolean;
  bytes: number;
  refs: RefList;
  rev: string;
  user: SessionUser | null;
}): string {
  const cut = opts.truncated
    ? `<p class="${c.binaryNotice}">Showing the first part of a ${esc(fmtBytes(opts.bytes))} file. Clone the repository to read all of it.</p>`
    : "";
  const content = opts.binary
    ? `<p class="${c.binaryNotice}">binary file not shown (${esc(fmtBytes(opts.bytes))})</p>`
    : `${cut}<pre class="${c.code}"><code>${esc(opts.text)}</code></pre>`;
  const q = revQuery(opts.rev, opts.refs.head);
  const upPath = opts.path.split("/").slice(0, -1).join("/");
  const body = `    <h1 class="${c.pageTitle}">${esc(opts.owner)}/${esc(opts.name)} &middot; ${esc(opts.path)}</h1>
${repoNav(opts.owner, opts.name, "tree", q)}
    <p class="${c.repoDesc}"><a href="${base(opts.owner, opts.name)}/tree/${esc(upPath)}${q}">&larr; back to ${esc(upPath || "tree")}</a></p>
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
  rev: string;
  user: SessionUser | null;
}): string {
  const cm = opts.commit;
  // A commit is reached from some branch; carrying that along keeps the tabs
  // pointing back where the reader came from.
  const q = `?h=${encodeURIComponent(opts.rev)}`;
  const body = `    <h1 class="${c.pageTitle}">${esc(cm.subject)}</h1>
${repoNav(opts.owner, opts.name, "log", q)}
    <dl class="${c.commitMeta}">
      <dt>commit</dt><dd class="${c.commitHash}">${esc(cm.hash)}</dd>
      <dt>author</dt><dd>${esc(cm.author)} &lt;${esc(cm.email)}&gt;</dd>
      <dt>date</dt><dd>${fmtDate(cm.time)}</dd>
    </dl>
    ${cm.body ? `<pre class="${c.code}">${esc(cm.body)}</pre>` : ""}
    ${cm.diffTruncated ? `<p class="${c.binaryNotice}">This diff is too large to show in full. Clone the repository to read all of it.</p>` : ""}
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
