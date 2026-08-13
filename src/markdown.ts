// A small, deliberately safe Markdown renderer for repository READMEs.
//
// Why hand-rolled rather than a library: README content is attacker-controlled
// — anyone who can push, on a repo that may be public — so this renderer is
// escape-first. Every character is HTML-escaped before any markup is produced,
// raw HTML from the source is never passed through, and link/image URLs go
// through a scheme allowlist. Injection is impossible by construction instead
// of depending on a sanitiser staying in step with a parser.
//
// Covers the README subset: ATX/setext headings, fenced and indented code,
// blockquotes, nested and task lists, GFM tables, rules, images, links,
// autolinks, emphasis, inline code, hard line breaks. Raw HTML blocks are
// dropped rather than shown as escaped source.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- inline -----------------------------------------------------------------

// Generated fragments (code spans, links, images) are parked in a stash and
// referenced by a NUL-delimited index, so later passes can't see inside them —
// a bare-URL autolink must not rewrite the href of a link we already built, and
// emphasis must not fire inside a code span. NULs are stripped from the source
// up front, so the markers are unambiguous.
type Stash = string[];

function park(s: Stash, html: string): string {
  s.push(html);
  return `\x00${s.length - 1}\x00`;
}

function unpark(text: string, s: Stash): string {
  // Fragments nest (a code span inside a link label), so expand repeatedly.
  let out = text;
  for (let pass = 0; pass < 5 && out.includes("\x00"); pass++) {
    out = out.replace(/\x00(\d+)\x00/g, (_m, n) => s[Number(n)] ?? "");
  }
  return out;
}

const ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i;

// Allow http(s), mailto and relative URLs; drop every other scheme so a README
// can't smuggle `javascript:` into an href. The input is already HTML-escaped,
// which means quotes can't break out of the attribute and an entity-obfuscated
// scheme (`javascript&#58;`) stays inert literal text.
function safeUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  if (ABSOLUTE.test(url)) return /^(?:https?|mailto):/i.test(url) ? url : null;
  return url;
}

function linkAttrs(href: string): string {
  // Untrusted outbound links: no referrer, no window handle, no PageRank.
  return ABSOLUTE.test(href) ? ` rel="nofollow noopener noreferrer"` : "";
}

function emphasis(t: string): string {
  return t
    .replace(/\*\*\*(\S[\s\S]*?\S|\S)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(\S[\s\S]*?\S|\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w\\])__(\S[\s\S]*?\S|\S)__(?!\w)/g, "$1<strong>$2</strong>")
    .replace(/(^|[^*\w\\])\*(\S[\s\S]*?\S|\S)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w\\])_(\S[\s\S]*?\S|\S)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~(\S[\s\S]*?\S|\S)~~/g, "<del>$1</del>");
}

function inline(src: string): string {
  const s: Stash = [];
  let text = escapeHtml(src.replace(/\x00/g, ""));

  // Code spans first — nothing inside them is markup.
  text = text.replace(/(`+)([\s\S]+?)\1/g, (_m, _ticks, code: string) =>
    park(s, `<code>${code.trim()}</code>`),
  );

  // Raw HTML. Nothing is ever passed through; the tags are dropped and the text
  // they wrapped is kept, which is what a README carrying `<p align="center">`
  // or `<details>` actually wants — showing the escaped source instead just
  // looks broken. `<br>` is the one tag worth honouring, and we emit our own.
  // Code spans are already parked above, so `` `<div>` `` still displays.
  // Prose that mentions a bare tag outside backticks loses it; that's the
  // trade, and backticks are the fix.
  text = text.replace(/&lt;!--[\s\S]*?--&gt;/g, "");
  text = text.replace(/&lt;br\s*\/?&gt;/gi, () => park(s, "<br>"));
  text = text.replace(
    /&lt;\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s(?:(?!&gt;)[\s\S])*?)?\/?&gt;/g,
    "",
  );

  // Images before links: `![alt](src)` also matches the link pattern.
  text = text.replace(
    /!\[([^\]]*)\]\(\s*((?:[^()\s]|\([^()\s]*\))+)(?:\s+&quot;(.*?)&quot;)?\s*\)/g,
    (_m, alt: string, url: string, title?: string) => {
      const src = safeUrl(url);
      if (!src) return alt;
      const t = title ? ` title="${title}"` : "";
      return park(s, `<img src="${src}" alt="${alt}"${t} loading="lazy">`);
    },
  );

  // One level of balanced parens is allowed in a URL — `…/Foo_(bar)` links are
  // common, and matching them here also means a `javascript:alert(1)` target
  // reaches safeUrl and gets dropped rather than surviving as literal text.
  text = text.replace(
    /\[([^\]]*)\]\(\s*((?:[^()\s]|\([^()\s]*\))+)(?:\s+&quot;(.*?)&quot;)?\s*\)/g,
    (_m, label: string, url: string, title?: string) => {
      const inner = emphasis(label);
      const href = safeUrl(url);
      if (!href) return inner;
      const t = title ? ` title="${title}"` : "";
      return park(s, `<a href="${href}"${t}${linkAttrs(href)}>${inner}</a>`);
    },
  );

  // Angle autolinks: `<https://…>`, already escaped to `&lt;…&gt;`.
  text = text.replace(
    /&lt;((?:https?:\/\/|mailto:)\S+?)&gt;/g,
    (_m, url: string) => park(s, `<a href="${url}"${linkAttrs(url)}>${url}</a>`),
  );

  // Bare URLs. The trailing class keeps sentence punctuation out of the link.
  text = text.replace(
    /(^|[\s(])(https?:\/\/[^\s<>()]*[^\s<>().,:!?'"])/g,
    (_m, pre: string, url: string) =>
      pre + park(s, `<a href="${url}"${linkAttrs(url)}>${url}</a>`),
  );

  return unpark(emphasis(text), s);
}

// Join a paragraph's lines, honouring hard breaks (two trailing spaces, or a
// trailing backslash).
function paragraph(lines: string[]): string {
  return lines
    .map((line, i) => {
      const hard = i < lines.length - 1 && /(?: {2,}|\\)$/.test(line);
      return inline(line.replace(/(?: +|\\)$/, "")) + (hard ? "<br>" : "");
    })
    .join("\n");
}

// ---- blocks -----------------------------------------------------------------

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const ATX = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*(\S*).*$/;
const RULE = /^\s{0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const QUOTE = /^\s{0,3}>/;

// Line access that reads past the end as a blank line — which every block rule
// below already treats as a terminator, so the bounds check comes for free.
function at(lines: string[], i: number): string {
  return lines[i] ?? "";
}

function indentOf(line: string): number {
  return /^\s*/.exec(line)?.[0].length ?? 0;
}

// A line consisting only of HTML tags (`<p align="center">`, `</div>`, `<br>`).
// We never emit raw HTML, and printing the escaped source would just be noise,
// so these are dropped. The tag-name pattern is deliberately strict so an
// autolink like `<https://example.com>` isn't mistaken for markup.
const HTML_ONLY = /^(?:<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>\s*)+$/;

function isHtmlOnly(line: string): boolean {
  const t = line.trim();
  return t.startsWith("<") && HTML_ONLY.test(t);
}

// Does this line interrupt a paragraph?
function isBlockStart(line: string): boolean {
  return (
    FENCE.test(line) ||
    RULE.test(line) ||
    ATX.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    isHtmlOnly(line) ||
    line.trimStart().startsWith("<!--")
  );
}

function isDelimiterRow(line: string): boolean {
  return /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-*:?\s*\|?\s*$/.test(line);
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function alignOf(cell: string): string {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return ` style="text-align:center"`;
  if (right) return ` style="text-align:right"`;
  return "";
}

function table(lines: string[], start: number): [string, number] {
  const heads = splitRow(at(lines, start));
  const aligns = splitRow(at(lines, start + 1)).map(alignOf);
  let i = start + 2;
  const rows: string[] = [];
  while (i < lines.length && at(lines, i).includes("|") && at(lines, i).trim()) {
    const cells = splitRow(at(lines, i));
    rows.push(
      `<tr>${heads
        .map(
          (_h, n) => `<td${aligns[n] ?? ""}>${inline(cells[n] ?? "")}</td>`,
        )
        .join("")}</tr>`,
    );
    i++;
  }
  const head = heads
    .map((h, n) => `<th${aligns[n] ?? ""}>${inline(h)}</th>`)
    .join("");
  return [
    `<table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`,
    i,
  ];
}

function list(lines: string[], start: number): [string, number] {
  const first = LIST_ITEM.exec(at(lines, start));
  if (!first) return ["", start + 1]; // unreachable: callers test first
  const bullet = first[2] ?? "-";
  const baseIndent = (first[1] ?? "").length;
  const ordered = /\d/.test(bullet);
  const items: string[][] = [];
  let item: string[] | null = null;
  let i = start;

  const flush = () => {
    if (item) items.push(item);
    item = null;
  };

  while (i < lines.length) {
    const line = at(lines, i);

    if (!line.trim()) {
      // A blank line ends the list unless the next line continues an item.
      const next = at(lines, i + 1);
      if (!next.trim()) break;
      if (!LIST_ITEM.test(next) && indentOf(next) <= baseIndent) break;
      if (item) item.push("");
      i++;
      continue;
    }

    const marker = LIST_ITEM.exec(line);
    const indent = indentOf(line);

    // Allow a space of jitter so `- a` / ` - b` stay siblings.
    if (marker && indent <= baseIndent + 1) {
      flush();
      item = [marker[3] ?? ""];
      i++;
      continue;
    }
    // Deeper content belongs to the current item; dedent so the recursive
    // parse sees a nested list / paragraph / code block at column zero.
    if (indent > baseIndent && item) {
      item.push(line.slice(Math.min(indent, baseIndent + 2)));
      i++;
      continue;
    }
    break;
  }
  flush();

  const html = items
    .map((raw) => {
      const task = /^\[([ xX])\]\s+([\s\S]*)$/.exec(raw[0] ?? "");
      const body = task ? [task[2] ?? "", ...raw.slice(1)] : raw;
      const checkbox = task
        ? `<input type="checkbox" disabled${task[1] === " " ? "" : " checked"}> `
        : "";
      // Tight items: unwrap a leading single paragraph so `<li>` reads inline.
      const rendered = blocks(body).replace(/^<p>([\s\S]*?)<\/p>(?=\n<|$)/, "$1");
      return `<li>${checkbox}${rendered}</li>`;
    })
    .join("\n");

  const tag = ordered ? "ol" : "ul";
  const startAttr =
    ordered && bullet.slice(0, -1) !== "1"
      ? ` start="${Number(bullet.slice(0, -1))}"`
      : "";
  return [`<${tag}${startAttr}>\n${html}\n</${tag}>`, i];
}

function blocks(lines: string[]): string {
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = at(lines, i);

    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const ticks = fence[1] ?? "```";
      const close = new RegExp(`^\\s{0,3}\\${ticks[0]}{${ticks.length},}\\s*$`);
      const buf: string[] = [];
      i++;
      while (i < lines.length && !close.test(at(lines, i))) buf.push(at(lines, i++));
      i++; // consume the closing fence (or run off the end)
      out.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // HTML comments: drop, possibly across several lines.
    if (line.trimStart().startsWith("<!--")) {
      while (i < lines.length && !at(lines, i).includes("-->")) i++;
      i++;
      continue;
    }

    if (RULE.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      const level = (atx[1] ?? "#").length;
      out.push(`<h${level}>${inline(atx[2] ?? "")}</h${level}>`);
      i++;
      continue;
    }

    // Setext headings. The `---` form is checked after RULE above, so a bare
    // rule on its own line still wins.
    const under = at(lines, i + 1);
    if (!isBlockStart(line)) {
      if (/^\s{0,3}=+\s*$/.test(under)) {
        out.push(`<h1>${inline(line.trim())}</h1>`);
        i += 2;
        continue;
      }
      if (/^\s{0,3}-+\s*$/.test(under)) {
        out.push(`<h2>${inline(line.trim())}</h2>`);
        i += 2;
        continue;
      }
    }

    if (QUOTE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && QUOTE.test(at(lines, i))) {
        buf.push(at(lines, i).replace(/^\s{0,3}>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>\n${blocks(buf)}\n</blockquote>`);
      continue;
    }

    if (line.includes("|") && isDelimiterRow(under)) {
      const [html, next] = table(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const [html, next] = list(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    // Indented code block.
    if (/^ {4}\S/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && (/^ {4}/.test(at(lines, i)) || !at(lines, i).trim())) {
        // A blank line only stays in the block if indented code resumes after it.
        if (!at(lines, i).trim() && !/^ {4}/.test(at(lines, i + 1))) break;
        buf.push(at(lines, i).slice(4));
        i++;
      }
      out.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    if (isHtmlOnly(line)) {
      i++;
      continue;
    }

    const buf: string[] = [];
    while (i < lines.length && at(lines, i).trim() && !isBlockStart(at(lines, i))) {
      buf.push(at(lines, i));
      i++;
    }
    if (buf.length === 0) {
      // A `<`-leading line that wasn't tag-only: keep it as escaped text.
      buf.push(line);
      i++;
    }
    out.push(`<p>${paragraph(buf)}</p>`);
  }

  return out.join("\n");
}

export function renderMarkdown(src: string): string {
  const lines = src
    .replace(/\r\n?/g, "\n")
    // Strip control characters (keeping tab + newline) so the stash markers
    // used during inline rendering can't collide with document content.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .split("\n");
  return blocks(lines);
}

// Strip inline markup down to readable text.
function flatten(s: string): string {
  const paren = "(?:[^()]|\\([^()]*\\))*";
  return s
    .replace(new RegExp(`!\\[[^\\]]*\\]\\(${paren}\\)`, "g"), " ")
    .replace(new RegExp(`\\[([^\\]]*)\\]\\(${paren}\\)`, "g"), "$1")
    .replace(/<[^<>]*>/g, " ")
    .replace(/[*_`~]/g, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// A one-line plain-text snippet for <meta> descriptions: the README's first
// paragraph of actual prose. Headings, badges, lists, tables and code are
// skipped — the opening heading is nearly always just the repo name, which the
// page title already carries.
export function plainSummary(src: string, max = 180): string {
  const text = src
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?(?:```|$)/g, "\n\n")
    .replace(/<!--[\s\S]*?-->/g, " ");

  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    const first = lines[0];
    if (first === undefined) continue;
    if (
      ATX.test(first) ||
      RULE.test(first) ||
      QUOTE.test(first) ||
      LIST_ITEM.test(first) ||
      isHtmlOnly(first) ||
      // Setext heading, or a table's header row.
      /^\s{0,3}(?:=+|-+)\s*$/.test(lines[1] ?? "") ||
      isDelimiterRow(lines[1] ?? "")
    ) {
      continue;
    }
    // An images-only block (a row of badges) flattens to nothing; keep looking.
    const flat = flatten(lines.join(" "));
    if (!flat) continue;
    return flat.length <= max
      ? flat
      : flat.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
  }
  return "";
}
