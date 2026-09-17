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
  accent: "#c22a44",
  accentAlt: "#9c1f34",
  gilt: "#d8b775",
  danger: "#ff4d5e",
  success: "#5f9e78",

  bgDeep: "#030207",
  bgRaised: "#100a10",
  bg: "#07050a",
  surface: "#1a1016",
  surfaceHi: "#241318",
  border: "#34141c",

  textFaint: "#6b4a53",
  textDim: "#82616a",
  textMuted: "#9c848c",
  textSoft: "#c7b6ba",
  text: "#ece3e6",

  font: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  display: "Georgia, 'Iowan Old Style', 'Palatino Linotype', serif",
  mono: "ui-monospace, 'Cascadia Code', Menlo, monospace",
  radius: "8px",
});

globalStyle(":root", { colorScheme: "dark" });
