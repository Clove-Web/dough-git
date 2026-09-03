/* src/icons.ts */
//
// Inline pixel icons, read straight from the installed `pixelarticons` package
// (MIT, © 2019 Gerrit Halfmann). No icon paths are copied into this repo, so
// the set always matches the installed version. esbuild keeps the package
// external (see scripts/build.mjs) and it ships as a runtime dependency, so
// getIconSvg resolves its svg/ files in dev and in the Docker image alike.

import { getIconSvg } from "pixelarticons";

// Parsed icon source, cached per name so each file is read once per process.
const cache = new Map<string, { viewBox: string; body: string }>();

function parse(name: string): { viewBox: string; body: string } {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  const source = getIconSvg(name);
  if (source === null) {
    throw new Error(`icon: unknown pixelarticons icon "${name}"`);
  }

  const viewBox = /viewBox="([^"]+)"/.exec(source)?.[1] ?? "0 0 24 24";
  const body = source
    .slice(source.indexOf(">") + 1, source.lastIndexOf("</svg>"))
    .replace(/\s*\n\s*/g, "")
    .replace(/>\s+</g, "><")
    .trim();

  const parsed = {
    viewBox,
    body,
  };
  cache.set(name, parsed);
  return parsed;
}

// Render one icon as an inline SVG string. `name` is any pixelarticons name
// (kebab-case, e.g. "git-branch", "folder", "lock"). Colour follows the
// parent's `currentColor`; the `.icon` class is styled in app.css.ts.
export function icon(name: string, size = 16): string {
  const { viewBox, body } = parse(name);
  return `<svg class="icon" viewBox="${viewBox}" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}
