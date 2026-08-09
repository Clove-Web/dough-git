/* Design tokens for minigit.
 *
 * Same shape as the personal site's themes.css.ts: a global theme *contract*
 * maps token names to literal CSS custom properties (surfaceHi => var(--
 * surface-hi)), and createGlobalTheme binds them on :root. Palette is the site's
 * pink dark-trans theme so minigit reads as part of the same family.
 */

import {
  createGlobalTheme,
  createGlobalThemeContract,
  globalStyle,
} from "@vanilla-extract/css";

export const vars = createGlobalThemeContract({
  accent: "accent",
  accentAlt: "accent-alt",
  danger: "danger",
  success: "success",

  bgDeep: "bg-deep",
  bgRaised: "bg-raised",
  bg: "bg",
  surface: "surface",
  surfaceHi: "surface-hi",
  border: "border",

  textFaint: "text-faint",
  textDim: "text-dim",
  textMuted: "text-muted",
  textSoft: "text-soft",
  text: "text",

  font: "font",
  mono: "mono",
  radius: "radius",
});

createGlobalTheme(":root", vars, {
  accent: "#f5a9b8",
  accentAlt: "#d15f8c",
  danger: "#d15f8c",
  success: "#f5a9b8",

  bgDeep: "#05060a",
  bgRaised: "#0e1017",
  bg: "#0a0b10",
  surface: "#12141c",
  surfaceHi: "#1b1e2a",
  border: "#232838",

  textFaint: "#5b6480",
  textDim: "#6b7391",
  textMuted: "#9aa3c2",
  textSoft: "#c9cfe0",
  text: "#f4f6fb",

  font: "system-ui, -apple-system, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  radius: "6px",
});

globalStyle(":root", { colorScheme: "dark" });
