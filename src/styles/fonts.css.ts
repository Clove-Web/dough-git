/* Comic Code — the same paid display face used across the other doughmination
 * sites (see the personal site's fonts.css.ts). Applied to the `font` token
 * (UI chrome: nav, headers, labels) — `mono` stays a real monospace stack in
 * theme.css.ts since dough-git aligns commit hashes, file sizes and tree
 * listings in columns, which Comic Code's metrics aren't built for.
 */

import { globalFontFace } from "@vanilla-extract/css";

const CDN = "https://m.doughmination.gay/f";

const COMIC_CODE = [
  { file: "ComicCode-Regular", weight: 400, style: "normal" },
  { file: "ComicCode-Italic", weight: 400, style: "italic" },
  { file: "ComicCode-Medium", weight: 500, style: "normal" },
  { file: "ComicCode-Bold", weight: 700, style: "normal" },
] as const;

for (const { file, weight, style } of COMIC_CODE) {
  globalFontFace("Comic Code", {
    src: `url('${CDN}/Comic-Code/woff2/${file}.woff2') format('woff2'), url('${CDN}/Comic-Code/woff/${file}.woff') format('woff')`,
    fontWeight: weight,
    fontStyle: style,
    fontDisplay: "swap",
  });
}
