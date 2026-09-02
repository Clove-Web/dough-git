/* src/views.ts */
//
// HTML rendering. Class names come from the compiled Vanilla Extract styles
// (src/styles). Repos are addressed GitHub-style as owner/name throughout.

import { config } from "./config.ts";
import { classes as c } from "./styles/index.ts";
import { escapeHtml, renderMarkdown, plainSummary } from "./markdown.ts";
import { sessionSlug } from "./auth.ts";
import { maskWebhook, mirrorHost, MIRROR_KINDS, type MirrorKind } from "./urls.ts";
import type { SessionUser } from "./auth.ts";
import type { CollaboratorRow } from "./access.ts";
import type { TokenRow } from "./tokens.ts";
import type { UserRow } from "./users.ts";
import type { Settings } from "./settings.ts";
import type {
  RepoSummary,
  Commit,
  TreeEntry,
  CommitDetail,
  Readme,
  RefList,
  TrashEntry,
  MirrorLink,
} from "./git.ts";
import type { MirrorStatus } from "./mirror.ts";

export const esc = escapeHtml;

function fmtDate(unix: number | null): string {
  if (!unix) return "";
  return new Date(unix * 1000).toISOString().slice(0, 16).replace("T", " ");
}

function base(owner: string, name: string): string {
  return `/${esc(owner)}/${esc(name)}`;
}

function cloneUrl(owner: string, name: string): string {
  return `${config.baseUrl}/${owner}/${name}.git`;
}

function revQuery(rev: string, head: string): string {
  return rev === head ? "" : `?h=${encodeURIComponent(rev)}`;
}

function revPicker(refs: RefList, rev: string): string {
  const all = [...refs.branches, ...refs.tags];
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

function metaText(s: string, max = 200): string {
  const flat = s.replace(/\s+/g, " ").trim();
  const clipped =
    flat.length > max ? flat.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : flat;
  return esc(clipped);
}

interface Profile {
  name: string | null;
  username: string | null;
  picture: string | null;
}

export function displayName(p: Profile & { sub?: string }): string {
  return p.name ?? p.username ?? p.sub ?? "user";
}

function avatar(p: Profile, size: "sm" | "lg"): string {
  const initial = esc(displayName(p).trim().slice(0, 1).toUpperCase() || "?");
  const box = size === "lg" ? c.avatarLg : c.avatarSm;
  const img = p.picture
    ? `<img class="${c.avatarImg}" src="${esc(p.picture)}" alt="" loading="lazy" data-avatar>`
    : "";
  return `<span class="${c.avatar} ${box}">${initial}${img}</span>`;
}

function layout(opts: {
  title: string;
  user: SessionUser | null;
  body: string;
  description?: string;
  path?: string;
  noindex?: boolean;
}): string {
  const whoami = opts.user
    ? `<a class="${c.user}" href="/${esc(ownerOf(opts.user))}">${avatar(opts.user, "sm")}${esc(displayName(opts.user))}</a>`
    : "";
  const settings = opts.user
    ? `<a class="${c.navLink}" href="/settings">settings</a>
       <a class="${c.navLink}" href="/auth/logout">logout</a>`
    : `<a class="${c.navLink}" href="/auth/login">login</a>`;

  const description = metaText(opts.description || config.description);
  const url = opts.path ? esc(config.baseUrl + opts.path) : esc(config.baseUrl);
  const icon = esc(config.favicon);
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

export function profilePage(opts: {
  owner: string;
  profile: UserRow | null;
  repos: RepoSummary[];
  user: SessionUser | null;
}): string {
  const p = opts.profile;
  const name = p ? displayName(p) : opts.owner;
  const handle = p?.username && p.username !== p.slug ? p.username : null;

  const known = p
    ? `<p class="${c.repoDesc}">@${esc(p.slug)}${handle ? ` &middot; ${esc(handle)}` : ""} &middot; joined ${fmtDate(p.created_at).slice(0, 10)}</p>`
    : `<p class="${c.repoDesc}">@${esc(opts.owner)} &middot; no account on this instance</p>`;

  const body = `    <section class="${c.profileHead}">
      ${avatar(p ?? { name: opts.owner, username: null, picture: null }, "lg")}
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
    noindex: !opts.repos.some((r) => r.isPublic),
  });
}

export function ownerOf(user: SessionUser): string {
  return sessionSlug(user);
}

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
  rawDescription: string;
  canPush: boolean;
  collaborators: CollaboratorRow[] | null;
  refs: RefList;
  rev: string;
  user: SessionUser | null;
  links: MirrorLink[];
  mirrorStatuses: Map<string, MirrorStatus>;
  localSha: string | null;
}): string {
  const title = `${opts.owner}/${opts.name}`;
  const empty = opts.empty;
  const q = revQuery(opts.rev, opts.refs.head);
  const pusher = opts.user ? ownerOf(opts.user) : opts.owner;
  const pushHint =
    empty && opts.canPush
      ? `    <section class="${c.cloneBox}">
      <p><strong>This repository is empty.</strong> Push to get started:</p>
      <code>git remote add mirror ${esc(cloneUrl(opts.owner, opts.name))}<br>git push --mirror mirror</code>
      <p class="${c.repoDesc}">When prompted, the <strong>username</strong> is <code>${esc(pusher)}</code> and the <strong>password</strong> is a token from <a href="/settings/tokens">settings</a>.</p>
    </section>`
      : empty
        ? `    <section class="${c.cloneBox}">
      <p class="${c.empty}">This repository is empty.</p>
    </section>`
        : "";

  const readmeSection = empty
    ? ""
    : opts.readme
      ? `    <h2 class="${c.sectionTitle}">${esc(opts.readme.path)}</h2>
    <article class="${c.readme}">
${renderMarkdown(opts.readme.text)}
    </article>`
      : `    <h2 class="${c.sectionTitle}">readme</h2>
    <p class="${c.empty}">No ReadMe was found, commit one to add a summary</p>`;

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
${mirrorSection(
  opts.owner,
  opts.name,
  opts.links,
  opts.mirrorStatuses,
  opts.localSha,
  isOwner,
  opts.canPush,
)}
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

function mirrorSection(
  owner: string,
  name: string,
  links: MirrorLink[],
  statuses: Map<string, MirrorStatus>,
  localSha: string | null,
  isOwner: boolean,
  canCheck: boolean,
): string {
  if (links.length === 0 && !isOwner) return "";

  const nowSec = Math.floor(Date.now() / 1000);

  const rows = links
    .map((link) => {
      const status = statuses.get(link.kind) ?? null;
      const view = describeMirror(link, status, nowSec);
      return `      <div class="${c.mirrorRow}">
        <span class="${c.mirrorKind}"><a href="${esc(link.url)}" rel="nofollow noopener noreferrer">${esc(link.kind)}</a></span>
        <span class="${view.cls}">${esc(view.label)}</span>
        <span class="${c.commitHash}">${esc(view.sha)}</span>
        <span class="${c.repoDesc}">${esc(view.detail)}</span>
      </div>${view.note ? `\n      <p class="${view.noteCls}">${esc(view.note)}</p>` : ""}`;
    })
    .join("\n");

  const local = localSha
    ? `      <div class="${c.mirrorRow}">
        <span class="${c.mirrorKind}">local</span>
        <span class="${c.statusMuted}">this repository</span>
        <span class="${c.commitHash}">${esc(localSha.slice(0, 7))}</span>
        <span></span>
      </div>`
    : "";

  const checkButton =
    canCheck && links.some((l) => !l.isPrivate)
      ? `      <form method="post" action="${base(owner, name)}/mirrors/check">
        <button type="submit">check now</button>
      </form>`
      : "";

  const body =
    links.length > 0
      ? `    <section class="${c.cloneBox}">
${rows}
${local}
${checkButton}
    </section>`
      : `    <p class="${c.empty}">No mirrors configured.</p>`;

  const field = (kind: MirrorKind) => {
    const existing = links.find((l) => l.kind === kind);
    return `      <div class="${c.formRow}">
        <label class="${c.cloneLabel}" for="mirror-${kind}">${kind}</label>
        <input id="mirror-${kind}" class="${c.grow}" type="url" name="${kind}"
          value="${esc(existing?.url ?? "")}" placeholder="https://${esc(mirrorHost(kind))}/user/repo">
        <label><input type="checkbox" name="${kind}_private"${existing?.isPrivate ? " checked" : ""}> private</label>
      </div>`;
  };

  const form = isOwner
    ? `    <form method="post" action="${base(owner, name)}/mirrors" class="${c.cloneBox}">
${MIRROR_KINDS.map(field).join("\n")}
      <p class="${c.repoDesc}">Only ${esc(MIRROR_KINDS.map(mirrorHost).join(" and "))} are accepted.
      Mark a mirror <em>private</em> to skip status checks — they are anonymous, so a private
      mirror would otherwise always look unreachable. Clear a field to remove it.</p>
      <button type="submit">save mirrors</button>
    </form>`
    : "";

  return `    <h2 class="${c.sectionTitle}">external mirrors</h2>
${body}
${form}`;
}

function describeMirror(
  link: MirrorLink,
  status: MirrorStatus | null,
  nowSec: number,
): {
  label: string;
  cls: string;
  sha: string;
  detail: string;
  note: string;
  noteCls: string;
} {
  const blank = { note: "", noteCls: c.repoDesc };

  if (link.isPrivate) {
    return {
      ...blank,
      label: "🔒 Not checked (private)",
      cls: c.statusMuted,
      sha: "",
      detail: "status checks are anonymous",
    };
  }
  if (!status || (!status.state && !status.error)) {
    return { ...blank, label: "— not checked yet", cls: c.statusMuted, sha: "", detail: "" };
  }

  const LABELS: Record<string, { label: string; cls: string }> = {
    synced: { label: "✓ Up to date", cls: c.statusGood },
    ahead: { label: "↑ Mirror behind", cls: c.statusWarn },
    behind: { label: "↓ Local behind", cls: c.statusWarn },
    diverged: { label: "⚠ Diverged", cls: c.statusBad },
    out_of_sync: { label: "⚠ Out of sync", cls: c.statusBad },
    denied: { label: "🔒 Private or missing", cls: c.statusWarn },
    missing: { label: "✗ Repository missing", cls: c.statusBad },
  };

  if (status.error) {
    const known = status.state ? LABELS[status.state] : undefined;
    const stale = status.okAt !== null && nowSec - status.okAt > 24 * 3600;
    return {
      label: known ? known.label : "? Unavailable",
      cls: known ? c.statusMuted : c.statusBad,
      sha: status.remoteSha ? status.remoteSha.slice(0, 7) : "",
      detail: status.okAt ? `last verified ${ago(nowSec - status.okAt)} ago` : "never verified",
      note:
        `${link.kind}: check failed ${ago(nowSec - status.checkedAt)} ago (${status.error})` +
        (status.okAt
          ? stale
            ? ` — NOT VERIFIED for ${ago(nowSec - status.okAt)}`
            : ` — showing last verified state from ${ago(nowSec - status.okAt)} ago`
          : ""),
      noteCls: stale || !status.okAt ? c.statusBad : c.statusWarn,
    };
  }

  const known = status.state ? LABELS[status.state] : undefined;
  const stale = status.okAt !== null && nowSec - status.okAt > 24 * 3600;
  return {
    label: known?.label ?? "? Unavailable",
    cls: known?.cls ?? c.statusBad,
    sha: status.remoteSha ? status.remoteSha.slice(0, 7) : "",
    detail: [status.detail, status.okAt ? `checked ${ago(nowSec - status.okAt)} ago` : ""]
      .filter(Boolean)
      .join(" · "),
    note: stale
      ? `${link.kind}: not verified for ${ago(nowSec - (status.okAt ?? nowSec))}`
      : "",
    noteCls: c.statusBad,
  };
}

function ago(seconds: number): string {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

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

function settingsNav(active: string): string {
  const tab = (id: string, label: string, href: string) =>
    `<a class="${c.tab}${id === active ? " " + c.tabActive : ""}" href="${href}">${label}</a>`;
  return `    <nav class="${c.repoTabs}">
      ${tab("account", "account", "/settings")}
      ${tab("tokens", "tokens", "/settings/tokens")}
      ${tab("deleted", "recently deleted", "/settings/deleted")}
    </nav>`;
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
          <form method="post" action="/settings/tokens/${esc(t.id)}/revoke">
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

  const body = `    <h1 class="${c.pageTitle}">settings</h1>
${settingsNav("tokens")}
    <h2 class="${c.sectionTitle}">access tokens</h2>
    <p class="${c.repoDesc}">These tokens act as <code>${esc(authUser)}</code>: use that as the git
    <strong>username</strong> and the token as the <strong>password</strong>. They can only push to
    repositories under <code>${esc(authUser)}/</code>.</p>
${created}
    <form method="post" action="/settings/tokens" class="${c.cloneBox}">
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

export function settingsPage(opts: {
  user: SessionUser | null;
  settings: Settings;
  saved?: string | null;
}): string {
  const s = opts.settings;
  const on = (v: boolean) => (v ? " checked" : "");

  const webhookState = s.discordWebhook
    ? `      <p class="${c.repoDesc}">configured &middot; <code>${esc(maskWebhook(s.discordWebhook))}</code></p>`
    : `      <p class="${c.empty}">not configured — repository events are not announced anywhere.</p>`;

  const webhookError =
    s.discordWebhook && s.webhookError
      ? `      <p class="${c.statusBad}">last delivery failed${
          s.webhookErrorAt ? ` at ${fmtDate(s.webhookErrorAt)}` : ""
        }: ${esc(s.webhookError)}</p>`
      : "";

  const clear = s.discordWebhook
    ? `      <form method="post" action="/settings/discord" data-confirm="Remove the Discord webhook? Events will stop being announced.">
        <input type="hidden" name="url" value="">
        <button type="submit">remove webhook</button>
      </form>`
    : "";

  const body = `    <h1 class="${c.pageTitle}">settings</h1>
${settingsNav("account")}
${opts.saved ? `    <p class="${c.statusGood}">${esc(opts.saved)}</p>` : ""}

    <h2 class="${c.sectionTitle}">discord notifications</h2>
    <p class="${c.repoDesc}">Announces repositories being created and deleted, and commits being
    pushed. Only repositories you own are announced, and only to this webhook.</p>
    <section class="${c.cloneBox}">
${webhookState}
${webhookError}
      <form method="post" action="/settings/discord" class="${c.formRow}">
        <label class="${c.cloneLabel}" for="discord-url">webhook</label>
        <input id="discord-url" class="${c.grow}" type="url" name="url" autocomplete="off"
          placeholder="https://discord.com/api/webhooks/…">
        <button type="submit">save</button>
      </form>
${clear}
    </section>

    <h2 class="${c.sectionTitle}">preferences</h2>
    <form method="post" action="/settings/prefs" class="${c.cloneBox}">
      <p><label><input type="checkbox" name="default_private"${on(s.defaultPrivate)}>
        New repositories start private</label></p>
      <p><label><input type="checkbox" name="discord_private"${on(s.discordPrivate)}>
        Announce activity on private repositories</label>
        <br><span class="${c.repoDesc}">Off by default: commit subjects and repository names
        would otherwise leave a private repo for a Discord channel.</span></p>
      <p><label><input type="checkbox" name="mirror_auto"${on(s.mirrorAuto)}>
        Check mirror status automatically when viewing a repository</label>
        <br><span class="${c.repoDesc}">Off means mirrors are only checked when you press
        <em>check now</em>.</span></p>
      <button type="submit">save preferences</button>
    </form>

    <h2 class="${c.sectionTitle}">account</h2>
    <p class="${c.repoDesc}">Your name and avatar come from PocketID and refresh on each sign-in,
    so there is nothing to edit here. Your owner namespace is
    <code>${esc(opts.user ? ownerOf(opts.user) : "")}</code> and never changes.</p>`;

  return layout({
    title: "settings",
    user: opts.user,
    body,
    description: "Account settings.",
    noindex: true,
  });
}

export function deletedPage(opts: {
  user: SessionUser | null;
  entries: TrashEntry[];
  retentionDays: number;
}): string {
  const nowSec = Math.floor(Date.now() / 1000);

  const rows = opts.entries
    .map((e) => {
      const remaining =
        opts.retentionDays > 0
          ? Math.ceil(
              (e.deletedAt + opts.retentionDays * 86400 - nowSec) / 86400,
            )
          : null;
      const life =
        remaining === null
          ? `<span class="${c.statusMuted}">kept until purged</span>`
          : remaining <= 0
            ? `<span class="${c.statusBad}">purged on next visit</span>`
            : remaining <= 3
              ? `<span class="${c.statusBad}">${remaining}d left</span>`
              : `<span class="${c.statusMuted}">${remaining}d left</span>`;

      const note = e.degraded
        ? `<br><span class="${c.statusWarn}">recovery metadata unreadable — restorable, but collaborators will need re-adding</span>`
        : e.grants.length
          ? `<br><span class="${c.repoDesc}">${e.grants.length} collaborator${e.grants.length === 1 ? "" : "s"} will be restored</span>`
          : "";

      return `      <tr>
        <td class="${c.repoName}">${esc(e.name)}${note}</td>
        <td class="${c.commitDate}">${fmtDate(e.deletedAt)}</td>
        <td class="${c.repoDesc}">${esc(e.deletedBy)}</td>
        <td>${life}</td>
        <td>
          <form method="post" action="/settings/deleted/restore">
            <input type="hidden" name="entry" value="${esc(e.entry)}">
            <button type="submit">restore</button>
          </form>
        </td>
        <td>
          <form method="post" action="/settings/deleted/purge" data-confirm="Permanently delete ${esc(e.name)}? This destroys the git data and cannot be undone.">
            <input type="hidden" name="entry" value="${esc(e.entry)}">
            <button type="submit">delete permanently</button>
          </form>
        </td>
      </tr>`;
    })
    .join("\n");

  const retention =
    opts.retentionDays > 0
      ? `Deleted repositories are kept for ${opts.retentionDays} days, then purged the next time you open this page.`
      : `Deleted repositories are kept indefinitely — nothing is purged unless you do it here.`;

  const body = `    <h1 class="${c.pageTitle}">settings</h1>
${settingsNav("deleted")}
    <h2 class="${c.sectionTitle}">recently deleted</h2>
    <p class="${c.repoDesc}">${esc(retention)} A deleted repository keeps its name reserved, so
    nothing new can take it until it is restored or purged.</p>
    <table>
      <thead>
        <tr><th>repository</th><th>deleted</th><th>by</th><th>retention</th><th></th><th></th></tr>
      </thead>
      <tbody>
${rows || `        <tr><td colspan="6" class="${c.empty}">nothing deleted</td></tr>`}
      </tbody>
    </table>`;

  return layout({
    title: "recently deleted",
    user: opts.user,
    body,
    description: "Recover deleted repositories.",
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
