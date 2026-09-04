/* src/styles/fonts.css.ts
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

import { globalFontFace } from "@vanilla-extract/css";

export const FONT_ORIGIN = "https://m.doughmination.gay";

const CDN = `${FONT_ORIGIN}/f`;

const COMIC_CODE = [
  { file: "ComicCode-Regular", weight: 400, style: "normal" },
  { file: "ComicCode-Italic", weight: 400, style: "italic" },
  { file: "ComicCode-Medium", weight: 500, style: "normal" },
  { file: "ComicCode-Bold", weight: 700, style: "normal" },
] as const;

globalFontFace("Ink Free", {
  src: `url('${CDN}/Ink-Free/Inkfree.woff2') format('woff2')`,
  fontWeight: 400,
  fontStyle: "normal",
  fontDisplay: "swap",
});

for (const { file, weight, style } of COMIC_CODE) {
  globalFontFace("Comic Code", {
    src: `url('${CDN}/Comic-Code/woff2/${file}.woff2') format('woff2')`,
    fontWeight: weight,
    fontStyle: style,
    fontDisplay: "swap",
  });
}
