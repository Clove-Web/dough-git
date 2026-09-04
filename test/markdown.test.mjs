/* test/markdown.test.mjs
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

import { renderMarkdown, plainSummary } from "../src/markdown.ts";

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

const has = (md, needle) => renderMarkdown(md).includes(needle);
const lacks = (md, needle) => !renderMarkdown(md).includes(needle);

check(
  "script tags are never emitted",
  lacks("<script>alert(1)</script>", "<script"),
);
check(
  "inline event handlers can't reach the output",
  lacks('<img src=x onerror="alert(1)">', "onerror"),
);
check(
  "javascript: links are dropped, label kept",
  lacks("[click](javascript:alert(1))", "javascript:") &&
    has("[click](javascript:alert(1))", "click"),
);
check(
  "data: image sources are dropped",
  lacks("![x](data:text/html;base64,PHN2Zz4=)", "data:"),
);
check(
  "entity-obfuscated schemes stay inert",
  lacks("[x](javascript&#58;alert(1))", "javascript:"),
);
check(
  "quotes in a URL can't break out of the href attribute",
  lacks('[x](https://e.xyz/" onmouseover="alert(1))', '" onmouseover="'),
);
check(
  "HTML inside a code fence is escaped, not executed",
  has("```\n<script>x</script>\n```", "&lt;script&gt;"),
);
check(
  "external links carry rel=nofollow noopener",
  has("[a](https://example.com)", 'rel="nofollow noopener noreferrer"'),
);
check(
  "relative links are allowed through",
  has("[docs](/docs/readme.md)", 'href="/docs/readme.md"'),
);

check("ATX heading", has("# Title", "<h1>Title</h1>"));
check("deeper ATX heading", has("### Three", "<h3>Three</h3>"));
check("setext heading", has("Title\n=====", "<h1>Title</h1>"));
check("paragraph", has("just words", "<p>just words</p>"));
check("horizontal rule", has("---\n", "<hr>"));
check("blockquote", has("> quoted", "<blockquote>"));
check(
  "a plain blockquote is not treated as an alert",
  has("> quoted", "<blockquote>") && lacks("> quoted", "md-alert"),
);

check(
  "note alert renders as a titled alert, not a blockquote",
  has("> [!NOTE]\n> Heads up.", 'class="md-alert md-alert-note"') &&
    lacks("> [!NOTE]\n> Heads up.", "<blockquote>"),
);
check(
  "note alert carries its title and body",
  has("> [!NOTE]\n> Heads up.", ">Note</p>") &&
    has("> [!NOTE]\n> Heads up.", "Heads up."),
);
check(
  "note alert includes an inline icon",
  has("> [!NOTE]\n> Heads up.", 'class="icon"'),
);
check(
  "tip alert",
  has("> [!TIP]\n> Handy.", 'class="md-alert md-alert-tip"'),
);
check(
  "important alert",
  has("> [!IMPORTANT]\n> Read this.", 'class="md-alert md-alert-important"'),
);
check(
  "warning alert",
  has("> [!WARNING]\n> Careful.", 'class="md-alert md-alert-warning"'),
);
check(
  "caution alert",
  has("> [!CAUTION]\n> Danger.", 'class="md-alert md-alert-caution"'),
);
check(
  "alert marker is case-insensitive",
  has("> [!note]\n> lower.", 'class="md-alert md-alert-note"'),
);
check(
  "an unknown marker stays a plain blockquote",
  has("> [!HINT]\n> nope.", "<blockquote>") &&
    lacks("> [!HINT]\n> nope.", "md-alert"),
);
check(
  "a marker with trailing text is not an alert",
  lacks("> [!NOTE] inline text", "md-alert"),
);
check(
  "alert body renders markdown",
  has("> [!NOTE]\n> Has **bold** text.", "<strong>bold</strong>"),
);
check(
  "alert markup can't be forged from README content",
  lacks("plain [!NOTE] not in a quote", "md-alert"),
);

check(
  "fenced code keeps its content verbatim",
  has("```js\nconst a = 1;\n```", "const a = 1;"),
);
check(
  "fence info string is not rendered as text",
  lacks("```js\nconst a = 1;\n```", ">js"),
);
check("unordered list", has("- one\n- two", "<ul>") && has("- one", "<li>one</li>"));
check("ordered list", has("1. one\n2. two", "<ol>"));
check(
  "ordered list honours a non-1 start",
  has("3. three\n4. four", '<ol start="3">'),
);
check(
  "nested list nests",
  /<ul>[\s\S]*<ul>[\s\S]*<\/ul>[\s\S]*<\/ul>/.test(
    renderMarkdown("- outer\n  - inner"),
  ),
);
check(
  "task list renders a disabled checkbox",
  has("- [x] done", 'type="checkbox"') && has("- [x] done", "checked"),
);
check(
  "unchecked task has no checked attribute",
  lacks("- [ ] todo", "checked"),
);
check("table head", has("| a | b |\n| - | - |\n| 1 | 2 |", "<th>a</th>"));
check("table body", has("| a | b |\n| - | - |\n| 1 | 2 |", "<td>1</td>"));
check(
  "table alignment centres",
  has("| a |\n| :-: |\n| 1 |", 'data-align="center"'),
);
check(
  "table alignment right-aligns",
  has("| a |\n| --: |\n| 1 |", 'data-align="right"'),
);
check(
  "table alignment never emits an inline style",
  lacks("| a |\n| :-: |\n| 1 |", "style="),
);
check(
  "raw HTML block lines are dropped, not printed as source",
  lacks('<p align="center">\ntext\n</p>', "&lt;p align"),
);
check(
  "text inside a dropped HTML block survives",
  has('<p align="center">\ntext\n</p>', "text"),
);
check("HTML comments are dropped", lacks("<!-- hidden -->\nvisible", "hidden"));
check(
  "inline HTML tags are dropped, wrapped text kept",
  has('<p align="center">centred</p>', "centred") &&
    lacks('<p align="center">centred</p>', "&lt;p"),
);
check(
  "a single-line script tag leaves no markup behind",
  lacks("<script>alert(1)</script>", "&lt;script") &&
    lacks("<script>alert(1)</script>", "<script"),
);
check(
  "<br> becomes a real line break",
  has("one<br>two", "<br>") && lacks("one<br>two", "&lt;br"),
);
check(
  "HTML inside a code span is displayed, not stripped",
  has("use `<div>` here", "<code>&lt;div&gt;</code>"),
);
check(
  "inline HTML comments are dropped",
  lacks("visible <!-- secret --> text", "secret"),
);

check("bold", has("**bold**", "<strong>bold</strong>"));
check("italic", has("*italic*", "<em>italic</em>"));
check("bold italic", has("***both***", "<strong><em>both</em></strong>"));
check("strikethrough", has("~~gone~~", "<del>gone</del>"));
check("inline code", has("`code`", "<code>code</code>"));
check(
  "emphasis does not fire inside a code span",
  has("`a_b_c`", "<code>a_b_c</code>"),
);
check(
  "snake_case words are left alone",
  lacks("some_var_name here", "<em>"),
);
check("image", has("![alt](/i.png)", '<img src="/i.png" alt="alt"'));
check("angle autolink", has("<https://example.com>", 'href="https://example.com"'));
check("bare URL autolink", has("see https://example.com now", "<a href="));
check(
  "trailing sentence punctuation stays outside the link",
  has("see https://example.com.", 'href="https://example.com"'),
);
check(
  "a link is not re-linked by the bare-URL pass",
  (renderMarkdown("[x](https://example.com)").match(/<a /g) ?? []).length === 1,
);
check("hard break", has("line one  \nline two", "<br>"));
check("ampersands are escaped once", has("a & b", "a &amp; b"));

check(
  "plainSummary skips the leading heading",
  plainSummary("# my-repo\n\nDoes a useful thing.") === "Does a useful thing.",
);
check(
  "plainSummary unwraps links and strips markup",
  plainSummary("A **bold** [link](https://e.xyz) here.") ===
    "A bold link here.",
);
check(
  "plainSummary drops code fences",
  plainSummary("Text.\n\n```\ncode here\n```").trim() === "Text.",
);
check(
  "plainSummary stops at the first prose paragraph",
  plainSummary("# repo\n\nFirst para.\n\nSecond para.") === "First para.",
);
check(
  "plainSummary skips a badge row",
  plainSummary("# repo\n\n![ci](https://b.svg) ![cov](https://c.svg)\n\nReal text.") ===
    "Real text.",
);
check(
  "plainSummary skips lists and tables",
  plainSummary("- one\n- two\n\n| a |\n| - |\n| 1 |\n\nProse.") === "Prose.",
);
check(
  "plainSummary skips a setext heading",
  plainSummary("Title\n=====\n\nBody text.") === "Body text.",
);
check(
  "plainSummary keeps parens inside a link target out of the text",
  plainSummary("See [it](https://e.xyz/Foo_(bar)) now.") === "See it now.",
);
check(
  "plainSummary truncates on a word boundary",
  (() => {
    const out = plainSummary("word ".repeat(100), 40);
    return out.length <= 40 && out.endsWith("…") && !out.includes("  ");
  })(),
);
check("plainSummary of an empty README is empty", plainSummary("") === "");

check("empty input renders nothing", renderMarkdown("") === "");
check(
  "unclosed fence doesn't hang or drop content",
  has("```\nunclosed", "unclosed"),
);
check(
  "CRLF input renders normally",
  has("# Title\r\n\r\nBody\r\n", "<h1>Title</h1>"),
);
check(
  "stray NUL bytes can't forge a stash placeholder",
  lacks("\x000\x00 text", "\x00"),
);

console.log("\n-- resource bounds (unbounded scans used to be quadratic) --");

function timed(label, src, budgetMs) {
  const t = process.hrtime.bigint();
  let threw = null;
  try {
    renderMarkdown(src);
  } catch (err) {
    threw = err;
  }
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  check(`${label} (${ms.toFixed(0)}ms, budget ${budgetMs}ms)`, threw === null && ms < budgetMs);
}

timed("200k unclosed [ does not go quadratic", "[".repeat(200_000), 3000);
timed("200k unclosed ![ does not go quadratic", "![".repeat(100_000), 3000);
timed("200k unclosed tag does not go quadratic", "<a ".repeat(66_000), 3000);
timed("200k unclosed autolink stays linear", "<http://".repeat(25_000), 3000);
timed("deep blockquote nesting does not overflow the stack", ">".repeat(50_000), 3000);
timed("deep list nesting does not overflow the stack", "- ".repeat(50_000) + "x", 3000);

check(
  "an oversize document is truncated and says so",
  has("x\n".repeat(200_000), "truncated for display"),
);
check(
  "an ordinary document is not marked truncated",
  lacks("# Title\n\nBody", "truncated for display"),
);

check("nested blockquotes still nest", has("> a\n>\n> > b", "<blockquote>\n<p>a</p>\n<blockquote>"));
check("nested lists still nest", has("- a\n  - b", "<ul>\n<li>a\n<ul>\n<li>b"));
check("autolinks still link", has("<https://example.com>", 'href="https://example.com"'));
check("ordinary links still link", has("[x](https://example.com)", 'href="https://example.com"'));
check("images still render", has("![alt](https://example.com/i.png)", '<img src="https://example.com/i.png"'));
check("link titles still render", has('[x](https://a.com "t")', 'title="t"'));

console.log("\n-- allowlisted html renders --");

check("centered div", has('<div align="center">x</div>', '<div align="center">'));
check("img with dimensions", has('<img src="l.png" width="200" height="9">', '<img src="l.png" width="200" height="9" loading="lazy">'));
check("img is not wrapped in a stray p", lacks('<div align="center">\n<img src="l.png">\n</div>', "<p>"));
check("centered heading is not wrapped in p", has('<h1 align="center">P</h1>', '<h1 align="center">P</h1>') && lacks('<h1 align="center">P</h1>', "<p>"));
check("anchor round-trips with rel", has('<a href="https://x.com">t</a>', '<a href="https://x.com" rel="nofollow noopener noreferrer">t</a>'));
check("details and summary", has("<details>\n<summary>s</summary>\n</details>", "<details>") && has("<details>\n<summary>s</summary>\n</details>", "<summary>s</summary>"));
check("markdown inside a details block still renders", has("<details>\n<summary>s</summary>\n\n**b**\n\n</details>", "<strong>b</strong>"));
check("picture and source", has('<picture>\n<source media="(prefers-color-scheme: dark)" srcset="d.png">\n</picture>', '<source media="(prefers-color-scheme: dark)" srcset="d.png">'));
check("inline kbd stays inline", has("press <kbd>C</kbd>", "<p>press <kbd>C</kbd></p>"));
check("html table", has('<table><tr><td align="right">1</td></tr></table>', '<td align="right">1</td>'));
check("center", has("<center>c</center>", "<center>c</center>"));
check("br and hr", has("a<br>b", "a<br>b") && has("<hr>", "<hr>"));
check("backticked tag is still code, not markup", has("use `<div>` here", "<code>&lt;div&gt;</code>"));

console.log("\n-- the allowlist is an allowlist --");

check("iframe is dropped", lacks('<iframe src="https://e.com"></iframe>', "<iframe"));
check("form and input are dropped", lacks('<form><input name="p"></form>', "<input"));
check("style tag is dropped", lacks("<style>body{}</style>", "<style"));
check("svg is dropped", lacks("<svg onload=alert(1)></svg>", "<svg"));
check("base is dropped", lacks('<base href="//e.com/">', "<base"));
check("event handlers never survive", lacks('<div onclick="alert(1)">x</div>', "onclick") && lacks("<img src=x onerror=alert(1)>", "onerror"));
check("style attribute never survives", lacks('<div style="x:url(javascript:1)">x</div>', "style="));
check("target never survives", lacks('<a href="https://x.com" target="_blank">t</a>', "target"));
check("class and id never survive", lacks('<div class="c" id="i">x</div>', "class=") && lacks('<div class="c" id="i">x</div>', "id="));
check("javascript: href is dropped, text kept", lacks('<a href="javascript:alert(1)">t</a>', "javascript:") && has('<a href="javascript:alert(1)">t</a>', "t"));
check("data: src is dropped", lacks('<img src="data:text/html;base64,PHN2Zz4=">', "data:"));
check("protocol-relative src is dropped", lacks('<img src="//evil.com/x.png">', "evil.com"));
check("javascript: in srcset is dropped", lacks('<source srcset="javascript:alert(1)">', "javascript:"));
check("one bad srcset candidate drops the attribute", lacks('<source srcset="a.png 1x, javascript:alert(1) 2x">', "javascript:"));
check("align only takes known values", lacks('<div align="center\" onclick=\"alert(1)">x</div>', "onclick"));
check("an unknown attribute is dropped", lacks('<div data-x="1">y</div>', "data-x"));

check("script content is dropped, not shown as text", has("<script>alert(2)</script>ok", "<p>ok</p>"));
check("style content is dropped", has("<style>body{x}</style>ok", "<p>ok</p>"));
check("a multi-line script block is dropped whole", lacks("a\n<script>\nalert(1)\n</script>\nb", "alert"));
check("an unclosed script swallows nothing after it", has("a\n<script>\nalert(1)", "<p>a</p>"));
check("a mid-line script is dropped, surrounds kept", has("hi <script>alert(1)</script> there", "hi") && lacks("hi <script>alert(1)</script> there", "alert"));
check("fenced code still shows tags literally", has("```\n<script>x</script>\n```", "&lt;script&gt;x&lt;/script&gt;"));
check("inline code still shows tags literally", has("use `<script>` here", "<code>&lt;script&gt;</code>"));

console.log("\n-- html is balanced, so a readme cannot escape its container --");

check("an unclosed tag is closed", has('<div align="center">', "</div>"));
check("unclosed nesting closes inside out", has("<div><span><b>", "<div><span><b></b></span></div>"));
check("a stray closing tag is dropped", lacks("</div>", "</div>"));
check("a stray page tag is dropped entirely", lacks("</article></body>", "</article>") && lacks("</article></body>", "</body>"));
check("closers cannot outnumber openers", has("<div>a</div></div></div>", "<div>a</div>") && lacks("<div>a</div></div></div>", "</div></div>"));
check("the internal tag markers never reach output", lacks("<div>x</div>", "\u0001") && lacks("<div>x</div>", "\u0002"));
check("a forged marker in source is inert", lacks("\u0001<script>alert(1)</script>\u0002", "<script"));

console.log("\n-- seven elemental alerts --");

for (const [kind, label] of [
  ["NOTE", "Note"], ["TIP", "Tip"], ["IMPORTANT", "Important"],
  ["WARNING", "Warning"], ["CAUTION", "Caution"],
  ["FROZEN", "Frozen"], ["ASIDE", "Aside"],
]) {
  const md = `> [!${kind}]\n> body`;
  check(`${kind} renders`, has(md, `md-alert-${kind.toLowerCase()}`) && has(md, `${label}</p>`));
}
check("alert kinds are case-insensitive", has("> [!frozen]\n> b", "md-alert-frozen"));
check("an unknown alert stays a blockquote", has("> [!SPARKLE]\n> b", "<blockquote>"));
check("alert body still renders markdown", has("> [!ASIDE]\n> **b**", "<strong>b</strong>"));

console.log("\n-- pride text --");

for (const flag of [
  "gay", "lesbian", "bisexual", "transgender", "pansexual",
  "asexual", "aromantic", "nonbinary", "queer",
]) {
  check(`pride="${flag}"`, has(`<p pride="${flag}">x</p>`, `<p class="md-pride md-pride-${flag}">x</p>`));
}
for (const [alias, real] of [
  ["trans", "transgender"], ["bi", "bisexual"], ["pan", "pansexual"],
  ["ace", "asexual"], ["aro", "aromantic"], ["enby", "nonbinary"],
  ["nb", "nonbinary"], ["mlm", "gay"], ["wlw", "lesbian"],
]) {
  check(`alias "${alias}" resolves to ${real}`, has(`<p pride="${alias}">x</p>`, `md-pride-${real}`));
}
check("pride works on span, inline", has('a <span pride="queer">b</span> c', '<span class="md-pride md-pride-queer">b</span>'));
check("markdown still renders inside", has('<p pride="gay">**b** and `c`</p>', "<strong>b</strong>"));
check("code inside keeps its own colour hook", has('<p pride="gay">`c`</p>', "<code>c</code>"));
check("styling stops at the closing tag", has('<p pride="gay">a</p>\n\nplain', "<p>plain</p>"));
check("a neighbouring paragraph is untouched", lacks('<p pride="gay">a</p>\n\nplain', '<p class="md-pride md-pride-gay">plain'));

console.log("\n-- pride fails closed --");

check("an unknown flag renders a plain paragraph", has('<p pride="wibble">x</p>', "<p>x</p>"));
check("an empty value renders plain", has('<p pride="">x</p>', "<p>x</p>"));
check("two flags in one value render plain", has('<p pride="gay lesbian">x</p>', "<p>x</p>"));
check("css cannot ride the attribute", lacks('<p pride="gay;background:url(javascript:1)">x</p>', "background"));
check("markup cannot ride the attribute", lacks('<p pride="gay&quot;&gt;&lt;script&gt;">x</p>', "<script"));
check("path characters are refused", has('<p pride="../../etc">x</p>', "<p>x</p>"));
check("pride is not allowed on div", lacks('<div pride="gay">x</div>', "md-pride"));
check("pride is not allowed on img", lacks('<img src="a.png" pride="gay">', "md-pride"));
check(
  "class cannot be set directly, so pride is the only route",
  lacks('<p class="md-pride md-pride-gay">x</p>', "md-pride"),
);
check("a repeated pride attribute yields one class", (() => {
  const out = renderMarkdown('<p pride="gay" pride="queer">x</p>');
  return (out.match(/md-pride-/g) ?? []).length === 1;
})());

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
