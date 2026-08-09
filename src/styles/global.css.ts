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
});

globalStyle("a", {
  color: vars.accent,
  textDecoration: "none",
});

globalStyle("a:hover", { textDecoration: "underline" });

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
