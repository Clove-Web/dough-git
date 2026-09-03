/* Global element styling — the parts that must target bare elements (html,
 * body, a, table, pre) rather than a generated class, so they live in
 * globalStyle exactly like the personal site's base.css.ts.
 */

import { globalStyle } from "@vanilla-extract/css";
import { vars } from "./theme.css";

globalStyle("*", { boxSizing: "border-box" });

globalStyle("html", {
  background: `linear-gradient(135deg, ${vars.bg} 0%, ${vars.bgRaised} 60%, ${vars.bgDeep} 100%)`,
  minHeight: "100%",
});

globalStyle("body", {
  margin: 0,
  minHeight: "100vh",
  fontFamily: vars.font,
  fontSize: "15px",
  lineHeight: 1.5,
  color: vars.text,
  cursor: "url('/static/cursors/default-dark.png') 4 1, default",
});

globalStyle("a", {
  color: vars.accent,
  textDecoration: "none",
});

globalStyle("a:hover", { textDecoration: "underline" });

// Self-hosted pixel cursor (dark art, since dough-git is always dark).
globalStyle("a, button", {
  cursor: "url('/static/cursors/pointer-dark.png') 12 1, pointer",
});

globalStyle("h1, h2, h3", {
  fontWeight: 600,
  lineHeight: 1.25,
});

globalStyle("table", {
  width: "100%",
  borderCollapse: "collapse",
});

globalStyle("th, td", {
  textAlign: "left",
  padding: "0.4rem 0.6rem",
  borderBottom: `1px solid ${vars.border}`,
  verticalAlign: "top",
});

globalStyle("th", {
  color: vars.textMuted,
  fontWeight: 600,
  fontSize: "0.85em",
});

globalStyle("code, pre", { fontFamily: vars.mono });

globalStyle("pre", {
  margin: 0,
  overflowX: "auto",
});

/* Form controls. Native buttons/inputs come with their own light-mode chrome
 * (system font, rounded corners, grey gradient) which reads as foreign against
 * the dark theme, so restyle them onto the same bordered-box idiom the `tab`
 * and `badge` classes use.
 */

// Text-ish inputs only — a checkbox gets its own treatment below, since border
// and background on one replace the box itself rather than framing it.
const FIELDS = [
  'input[type="text"]',
  'input[type="url"]',
  'input[type="email"]',
  'input[type="password"]',
  'input[type="search"]',
  'input[type="number"]',
  "select",
  "textarea",
];

const CONTROLS = ["button", ...FIELDS];

/** sel(["button", "select"], ":hover") => "button:hover, select:hover" */
const sel = (sels: string[], suffix = "") =>
  sels.map((s) => s + suffix).join(", ");

globalStyle(sel(CONTROLS), {
  fontFamily: "inherit",
  fontSize: "inherit",
  lineHeight: 1.5,
  padding: "0.2rem 0.7rem",
  border: `1px solid ${vars.border}`,
  borderRadius: vars.radius,
});

globalStyle("button", {
  // Buttons are always [icon, label], so centre them as a row rather than
  // relying on the SVG's inline baseline.
  display: "inline-flex",
  alignItems: "center",
  gap: "0.35rem",
  background: vars.surfaceHi,
  color: vars.textSoft,
});

globalStyle("button:hover", {
  borderColor: vars.accent,
  color: vars.text,
});

globalStyle("button:active", { background: vars.surface });

globalStyle(sel(FIELDS), {
  background: vars.bgDeep,
  color: vars.text,
  minWidth: 0,
});

globalStyle(sel(FIELDS, "::placeholder"), { color: vars.textFaint });

globalStyle(sel(FIELDS, ":hover"), { borderColor: vars.textFaint });

// One focus treatment across the set, so tabbing through a form is consistent.
globalStyle(sel(CONTROLS, ":focus-visible"), {
  outline: `1px solid ${vars.accent}`,
  outlineOffset: "1px",
  borderColor: vars.accent,
});

globalStyle(sel(CONTROLS, ":disabled"), {
  opacity: 0.5,
  cursor: "not-allowed",
});

globalStyle('input[type="checkbox"]', {
  accentColor: vars.accent,
  verticalAlign: "-0.1em",
  margin: "0 0.35rem 0 0",
});

globalStyle('label:has(input[type="checkbox"])', {
  cursor: "url('/static/cursors/pointer-dark.png') 12 1, pointer",
});
