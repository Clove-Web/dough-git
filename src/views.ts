// HTML rendering. Class names come from the compiled Vanilla Extract styles
// (src/styles), so all visual styling is authored in .css.ts and bundled to a
// single static stylesheet — zero runtime CSS here.

import { config } from "./config.ts";
import { classes as c } from "./styles/index.ts";
import type { SessionUser } from "./auth.ts";
import type {
  RepoSummary,
  Commit,
  TreeEntry,
  CommitDetail,
} from "./git.ts";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(unix: number | null): string {
  if (!unix) return "";
  return new Date(unix * 1000).toISOString().slice(0, 16).replace("T", " ");
}

function layout(opts: {
  title: string;
  user: SessionUser | null;
  body: string;
}): string {
  const authLink = opts.user
    ? `<span class="${c.user}">${esc(opts.user.name ?? opts.user.email ?? opts.user.sub)}</span>
       <a class="${c.navLink}" href="/auth/logout">logout</a>`
    : `<a class="${c.navLink}" href="/auth/login">login</a>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(opts.title)}</title>
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
  <header class="${c.siteHeader}">
    <a class="${c.siteTitle}" href="/">${esc(config.title)}</a>
    <nav class="${c.siteNav}">${authLink}</nav>
  </header>
  <main class="${c.content}">
${opts.body}
  </main>
  <footer class="${c.siteFooter}">
    <span>minigit &middot; a minimal git mirror</span>
  </footer>
</body>
</html>`;
}

export function repoListPage(
  repos: RepoSummary[],
  user: SessionUser | null,
): string {
  const rows = repos
    .map(
      (r) => `      <tr class="${c.repoRow}">
        <td class="${c.repoName}"><a href="/${esc(r.name)}/">${esc(r.name)}</a></td>
        <td class="${c.repoDesc}">${esc(r.description)}</td>
        <td class="${c.repoVis}">${r.isPublic ? "public" : "private"}</td>
        <td class="${c.repoIdle}">${fmtDate(r.lastCommit)}</td>
      </tr>`,
    )
    .join("\n");

  const body = `    <h1 class="${c.pageTitle}">repositories</h1>
    <table class="${c.repoList}">
      <thead>
        <tr><th>name</th><th>description</th><th>visibility</th><th>updated</th></tr>
      </thead>
      <tbody>
${rows || `        <tr><td colspan="4" class="${c.empty}">no repositories visible</td></tr>`}
      </tbody>
    </table>`;
  return layout({ title: config.title, user, body });
}

function cloneUrl(name: string): string {
  return `${config.baseUrl}/${name}.git`;
}

function repoNav(name: string, active: string): string {
  const tab = (id: string, label: string, href: string) =>
    `<a class="${c.tab}${id === active ? " " + c.tabActive : ""}" href="${href}">${label}</a>`;
  return `    <nav class="${c.repoTabs}">
      ${tab("summary", "summary", `/${esc(name)}/`)}
      ${tab("log", "log", `/${esc(name)}/log`)}
      ${tab("tree", "tree", `/${esc(name)}/tree`)}
    </nav>`;
}

export function summaryPage(opts: {
  name: string;
  description: string;
  isPublic: boolean;
  branch: string;
  commits: Commit[];
  user: SessionUser | null;
}): string {
  const body = `    <h1 class="${c.pageTitle}">${esc(opts.name)}</h1>
    <p class="${c.repoDesc}">${esc(opts.description)}</p>
${repoNav(opts.name, "summary")}
    <section class="${c.cloneBox}">
      <span class="${c.cloneLabel}">clone</span>
      <code>git clone ${esc(cloneUrl(opts.name))}</code>
    </section>
    <h2 class="${c.sectionTitle}">recent commits</h2>
    ${commitTable(opts.name, opts.commits)}`;
  return layout({ title: opts.name, user: opts.user, body });
}

function commitTable(name: string, commits: Commit[]): string {
  const rows = commits
    .map(
      (cm) => `      <tr>
        <td class="${c.commitDate}">${fmtDate(cm.time)}</td>
        <td class="${c.commitSubject}"><a href="/${esc(name)}/commit/${esc(cm.hash)}">${esc(cm.subject)}</a></td>
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

export function logPage(opts: {
  name: string;
  commits: Commit[];
  user: SessionUser | null;
}): string {
  const body = `    <h1 class="${c.pageTitle}">${esc(opts.name)} &middot; log</h1>
${repoNav(opts.name, "log")}
    ${commitTable(opts.name, opts.commits)}`;
  return layout({ title: `${opts.name} log`, user: opts.user, body });
}

export function treePage(opts: {
  name: string;
  path: string;
  entries: TreeEntry[];
  user: SessionUser | null;
}): string {
  const crumb = opts.path ? ` /${esc(opts.path)}` : "";
  const rows = opts.entries
    .map((e) => {
      const childPath = opts.path ? `${opts.path}/${e.name}` : e.name;
      const href =
        e.type === "tree"
          ? `/${esc(opts.name)}/tree/${esc(childPath)}`
          : `/${esc(opts.name)}/blob/${esc(childPath)}`;
      return `      <tr class="${c.repoRow}">
        <td class="${c.treeMode}">${esc(e.mode)}</td>
        <td class="${c.treeName}"><a href="${href}">${esc(e.name)}${e.type === "tree" ? "/" : ""}</a></td>
        <td class="${c.treeSize}">${esc(e.size)}</td>
      </tr>`;
    })
    .join("\n");

  const body = `    <h1 class="${c.pageTitle}">${esc(opts.name)} &middot; tree${crumb}</h1>
${repoNav(opts.name, "tree")}
    <table class="${c.treeList}">
      <tbody>
${rows || `        <tr><td class="${c.empty}">empty</td></tr>`}
      </tbody>
    </table>`;
  return layout({ title: `${opts.name} tree`, user: opts.user, body });
}

export function blobPage(opts: {
  name: string;
  path: string;
  binary: boolean;
  text: string;
  user: SessionUser | null;
}): string {
  const content = opts.binary
    ? `<p class="${c.binaryNotice}">binary file not shown</p>`
    : `<pre class="${c.code}"><code>${esc(opts.text)}</code></pre>`;
  const body = `    <h1 class="${c.pageTitle}">${esc(opts.name)} &middot; ${esc(opts.path)}</h1>
${repoNav(opts.name, "tree")}
    ${content}`;
  return layout({ title: opts.path, user: opts.user, body });
}

export function commitPage(opts: {
  name: string;
  commit: CommitDetail;
  user: SessionUser | null;
}): string {
  const cm = opts.commit;
  const body = `    <h1 class="${c.pageTitle}">${esc(cm.subject)}</h1>
${repoNav(opts.name, "log")}
    <dl class="${c.commitMeta}">
      <dt>commit</dt><dd class="${c.commitHash}">${esc(cm.hash)}</dd>
      <dt>author</dt><dd>${esc(cm.author)} &lt;${esc(cm.email)}&gt;</dd>
      <dt>date</dt><dd>${fmtDate(cm.time)}</dd>
    </dl>
    ${cm.body ? `<pre class="${c.code}">${esc(cm.body)}</pre>` : ""}
    <pre class="${c.code}"><code>${esc(cm.diff)}</code></pre>`;
  return layout({ title: cm.subject, user: opts.user, body });
}

export function messagePage(opts: {
  title: string;
  message: string;
  user: SessionUser | null;
  status?: number;
}): string {
  const body = `    <h1 class="${c.pageTitle}">${esc(opts.title)}</h1>
    <p class="${c.message}">${esc(opts.message)}</p>`;
  return layout({ title: opts.title, user: opts.user, body });
}
