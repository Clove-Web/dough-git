// HTML rendering. Class names come from the compiled Vanilla Extract styles
// (src/styles), so all visual styling is authored in .css.ts and bundled to a
// single static stylesheet — zero runtime CSS here.

import { config } from "./config.ts";
import { classes as c } from "./styles/index.ts";
import type { SessionUser } from "./auth.ts";
import type { TokenRow } from "./tokens.ts";
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
    ? `<a class="${c.navLink}" href="/tokens">tokens</a>
       <span class="${c.user}">${esc(opts.user.name ?? opts.user.email ?? opts.user.sub)}</span>
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
    <span>dough-git &middot; a minimal git mirror</span>
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
        <td class="${c.repoVis}">${esc(r.owner)}</td>
        <td class="${c.repoVis}">${r.isPublic ? "public" : "private"}</td>
        <td class="${c.repoIdle}">${fmtDate(r.lastCommit)}</td>
      </tr>`,
    )
    .join("\n");

  const createForm = user
    ? `    <form method="post" action="/new" class="${c.cloneBox}">
      <label class="${c.cloneLabel}">new repo</label>
      <input type="text" name="name" placeholder="my-project" pattern="[A-Za-z0-9._-]+" required>
      <button type="submit">create</button>
    </form>`
    : "";

  const body = `    <h1 class="${c.pageTitle}">repositories</h1>
${createForm}
    <table class="${c.repoList}">
      <thead>
        <tr><th>name</th><th>description</th><th>owner</th><th>visibility</th><th>updated</th></tr>
      </thead>
      <tbody>
${rows || `        <tr><td colspan="5" class="${c.empty}">no repositories visible</td></tr>`}
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
  owner: string;
  branch: string;
  commits: Commit[];
  user: SessionUser | null;
}): string {
  const meta = [
    opts.isPublic ? "public" : "private",
    opts.owner ? `owner: ${esc(opts.owner)}` : "",
  ]
    .filter(Boolean)
    .join(" &middot; ");
  const commitsSection =
    opts.commits.length === 0
      ? `    <section class="${c.cloneBox}">
      <p><strong>This repository is empty.</strong> Push to get started:</p>
      <code>git remote add mirror ${esc(cloneUrl(opts.name))}<br>git push --mirror mirror</code>
    </section>`
      : `    <h2 class="${c.sectionTitle}">recent commits</h2>
    ${commitTable(opts.name, opts.commits)}`;

  const manage = opts.user
    ? `    <h2 class="${c.sectionTitle}">manage</h2>
    <div class="${c.repoTabs}">
      <form method="post" action="/${esc(opts.name)}/visibility">
        <input type="hidden" name="public" value="${opts.isPublic ? "" : "on"}">
        <button type="submit">make ${opts.isPublic ? "private" : "public"}</button>
      </form>
      <form method="post" action="/${esc(opts.name)}/delete" onsubmit="return confirm('Delete ${esc(opts.name)} permanently? This cannot be undone.');">
        <button type="submit">delete repository</button>
      </form>
    </div>`
    : "";

  const body = `    <h1 class="${c.pageTitle}">${esc(opts.name)}</h1>
    <p class="${c.repoDesc}">${meta}</p>
${repoNav(opts.name, "summary")}
    <section class="${c.cloneBox}">
      <span class="${c.cloneLabel}">clone</span>
      <code>git clone ${esc(cloneUrl(opts.name))}</code>
    </section>
${commitsSection}
${manage}`;
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

  const created = opts.newToken
    ? `    <section class="${c.cloneBox}">
      <p><strong>New token — copy it now, it won't be shown again:</strong></p>
      <code>${esc(opts.newToken)}</code>
      <p class="${c.repoDesc}">Use it as the password (any username), e.g.<br>
      <code>git remote add mirror ${esc(config.baseUrl.replace("://", `://x-token:${opts.newToken}@`))}/&lt;repo&gt;.git</code></p>
    </section>`
    : "";

  const body = `    <h1 class="${c.pageTitle}">access tokens</h1>
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
  return layout({ title: "tokens", user: opts.user, body });
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
