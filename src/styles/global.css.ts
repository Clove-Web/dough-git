/* src/styles/global.css.ts
 * LICENCED DASL-1.0 (c) Clove Twilight
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
