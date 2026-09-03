/* src/icons.ts */

// Icons are read from the installed pixelarticons package (MIT); none copied in.
import { getIconSvg } from "pixelarticons";

// Parsed icon source, cached so each file is read once per process.
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

// Render one pixelarticons icon (kebab-case name) as an inline SVG string.
export function icon(name: string, size = 16): string {
  const { viewBox, body } = parse(name);
  return `<svg class="icon" viewBox="${viewBox}" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}
