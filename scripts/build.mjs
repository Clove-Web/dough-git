/* scripts/build.mjs
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

import { build } from "esbuild";
import { vanillaExtractPlugin } from "@vanilla-extract/esbuild-plugin";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";

await build({
  entryPoints: { server: "src/server.ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  external: ["/static/*"],
  outdir: "dist",
  minify: true,
  logLevel: "info",
  plugins: [vanillaExtractPlugin()],
});

mkdirSync("public", { recursive: true });
if (existsSync("dist/server.css")) {
  copyFileSync("dist/server.css", "public/style.css");
  console.log("build: wrote public/style.css");
} else {
  throw new Error("build: expected dist/server.css was not emitted");
}
