/* src/styles/theme.css.ts
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

import {
  createGlobalTheme,
  createGlobalThemeContract,
  globalStyle,
} from "@vanilla-extract/css";

export const vars = createGlobalThemeContract({
  accent: "accent",
  accentAlt: "accent-alt",
  gilt: "gilt",
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
  display: "display",
  mono: "mono",
  radius: "radius",
});

createGlobalTheme(":root", vars, {
  accent: "#5cd1e6",
  accentAlt: "#34a9c6",
  gilt: "#d8b775",
  danger: "#ec6a80",
  success: "#4fc9a4",

  bgDeep: "#02060c",
  bgRaised: "#0b1726",
  bg: "#060d18",
  surface: "#112035",
  surfaceHi: "#1c2f48",
  border: "#294464",

  textFaint: "#64809c",
  textDim: "#7a95b0",
  textMuted: "#93aec7",
  textSoft: "#c2d6e6",
  text: "#eaf4fb",

  font: "'Comic Code', system-ui, -apple-system, sans-serif",
  display: "'Ink Free', 'Comic Code', system-ui, -apple-system, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  radius: "0",
});

globalStyle(":root", { colorScheme: "dark" });
