// Build step. Vanilla Extract needs a bundler to turn .css.ts into static CSS,
// so we run esbuild with the vanilla-extract plugin. It bundles the server to
// dist/server.js and, as a side effect of the styles being imported, emits the
// extracted stylesheet to dist/server.css — which we copy to public/style.css
// (served at /static/style.css).
//
// Run with plain Node:  npm run build

import { build } from "esbuild";
import { vanillaExtractPlugin } from "@vanilla-extract/esbuild-plugin";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";

await build({
  entryPoints: { server: "src/server.ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Keep runtime deps (hono, openid-client, @hono/node-server) external so they
  // resolve from node_modules at run time; only our own code + .css.ts is bundled.
  packages: "external",
  outdir: "dist",
  minify: true,
  logLevel: "info",
  plugins: [vanillaExtractPlugin()],
});

// Surface the compiled CSS where the static handler serves it.
mkdirSync("public", { recursive: true });
if (existsSync("dist/server.css")) {
  copyFileSync("dist/server.css", "public/style.css");
  console.log("build: wrote public/style.css");
} else {
  throw new Error("build: expected dist/server.css was not emitted");
}
