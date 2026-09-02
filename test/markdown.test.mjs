// Tests for the README Markdown renderer.
//
// The security cases matter most: README content comes from anyone who can
// push, and renders on pages that may be public, so the escape-first contract
// in src/markdown.ts (no raw HTML through, scheme allowlist on URLs) is the
// thing most worth pinning down.
//
// Run:  node --experimental-strip-types test/markdown.test.mjs

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

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
