/* src/markdown.ts */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Stash = string[];

function park(s: Stash, html: string): string {
  s.push(html);
  return `\x00${s.length - 1}\x00`;
}

function unpark(text: string, s: Stash): string {
  let out = text;
  for (let pass = 0; pass < 5 && out.includes("\x00"); pass++) {
    out = out.replace(/\x00(\d+)\x00/g, (_m, n) => s[Number(n)] ?? "");
  }
  return out;
}

const ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i;

function safeUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  if (ABSOLUTE.test(url)) return /^(?:https?|mailto):/i.test(url) ? url : null;
  if (/^[/\\]{2}/.test(url)) return null;
  return url;
}

function linkAttrs(href: string): string {
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

  text = text.replace(/(`+)([\s\S]+?)\1/g, (_m, _ticks, code: string) =>
    park(s, `<code>${code.trim()}</code>`),
  );

  text = text.replace(/&lt;!--[\s\S]*?--&gt;/g, "");
  text = text.replace(/&lt;br\s*\/?&gt;/gi, () => park(s, "<br>"));
  text = text.replace(
    /&lt;\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s(?:(?!&gt;)[\s\S])*?)?\/?&gt;/g,
    "",
  );

  text = text.replace(
    /!\[([^\]]*)\]\(\s*((?:[^()\s]|\([^()\s]*\))+)(?:\s+&quot;(.*?)&quot;)?\s*\)/g,
    (_m, alt: string, url: string, title?: string) => {
      const src = safeUrl(url);
      if (!src) return alt;
      const t = title ? ` title="${title}"` : "";
      return park(s, `<img src="${src}" alt="${alt}"${t} loading="lazy">`);
    },
  );

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

  text = text.replace(
    /&lt;((?:https?:\/\/|mailto:)\S+?)&gt;/g,
    (_m, url: string) => park(s, `<a href="${url}"${linkAttrs(url)}>${url}</a>`),
  );

  text = text.replace(
    /(^|[\s(])(https?:\/\/[^\s<>()]*[^\s<>().,:!?'"])/g,
    (_m, pre: string, url: string) =>
      pre + park(s, `<a href="${url}"${linkAttrs(url)}>${url}</a>`),
  );

  return unpark(emphasis(text), s);
}

function paragraph(lines: string[]): string {
  return lines
    .map((line, i) => {
      const hard = i < lines.length - 1 && /(?: {2,}|\\)$/.test(line);
      return inline(line.replace(/(?: +|\\)$/, "")) + (hard ? "<br>" : "");
    })
    .join("\n");
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const ATX = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*(\S*).*$/;
const RULE = /^\s{0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const QUOTE = /^\s{0,3}>/;

// GitHub alert marker: the whole first line of a blockquote, nothing else.
const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;

// Inline octicon SVGs, keyed by alert kind. Self-contained: no icon pack,
// no external request, in keeping with this renderer's escape-first design.
const ALERT_ICON: Record<string, string> = {
  note: '<svg class="md-alert-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>',
  tip: '<svg class="md-alert-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"></path></svg>',
  important: '<svg class="md-alert-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>',
  warning: '<svg class="md-alert-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>',
  caution: '<svg class="md-alert-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>',
};

function alertBlock(kind: string, body: string[]): string {
  const key = kind.toLowerCase();
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  const icon = ALERT_ICON[key] ?? "";
  const inner = blocks(body);
  const title = `<p class="md-alert-title">${icon}${label}</p>`;
  return `<div class="md-alert md-alert-${key}">\n${title}\n${inner}\n</div>`;
}

function at(lines: string[], i: number): string {
  return lines[i] ?? "";
}

function indentOf(line: string): number {
  return /^\s*/.exec(line)?.[0].length ?? 0;
}

const HTML_ONLY = /^(?:<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>\s*)+$/;

function isHtmlOnly(line: string): boolean {
  const t = line.trim();
  return t.startsWith("<") && HTML_ONLY.test(t);
}

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
  if (left && right) return ` data-align="center"`;
  if (right) return ` data-align="right"`;
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
  if (!first) return ["", start + 1];
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
      const next = at(lines, i + 1);
      if (!next.trim()) break;
      if (!LIST_ITEM.test(next) && indentOf(next) <= baseIndent) break;
      if (item) item.push("");
      i++;
      continue;
    }

    const marker = LIST_ITEM.exec(line);
    const indent = indentOf(line);

    if (marker && indent <= baseIndent + 1) {
      flush();
      item = [marker[3] ?? ""];
      i++;
      continue;
    }
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
      i++;
      out.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

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

      const marker = ALERT.exec(buf[0] ?? "");
      if (marker) {
        out.push(alertBlock(marker[1] ?? "", buf.slice(1)));
        continue;
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

    if (/^ {4}\S/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && (/^ {4}/.test(at(lines, i)) || !at(lines, i).trim())) {
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
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .split("\n");
  return blocks(lines);
}

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
      /^\s{0,3}(?:=+|-+)\s*$/.test(lines[1] ?? "") ||
      isDelimiterRow(lines[1] ?? "")
    ) {
      continue;
    }
    const flat = flatten(lines.join(" "));
    if (!flat) continue;
    return flat.length <= max
      ? flat
      : flat.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
  }
  return "";
}
