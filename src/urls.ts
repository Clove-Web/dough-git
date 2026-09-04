/* src/urls.ts
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

const MAX_URL = 400;

const HOSTILE = /[\s\\<>"'`{}|^\x00-\x1f\x7f]/;

function parseStrict(
  raw: string,
  allowedHosts: readonly string[],
  allowedParams: readonly string[] = [],
): URL | null {
  const value = raw.trim();
  if (!value || value.length > MAX_URL) return null;
  if (HOSTILE.test(value)) return null;
  if (value.startsWith("-")) return null;
  if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port) return null;
  if (url.hash) return null;
  if (!allowedHosts.includes(url.hostname)) return null;

  if (url.search) {
    const seen = new Set<string>();
    for (const key of url.searchParams.keys()) {
      if (!allowedParams.includes(key)) return null;
      if (seen.has(key)) return null;
      seen.add(key);
    }
  }

  return url;
}

export const MIRROR_KINDS = ["github", "codeberg"] as const;
export type MirrorKind = (typeof MIRROR_KINDS)[number];

const MIRROR_HOSTS: Record<MirrorKind, string> = {
  github: "github.com",
  codeberg: "codeberg.org",
};

export function isMirrorKind(value: string): value is MirrorKind {
  return (MIRROR_KINDS as readonly string[]).includes(value);
}

export function mirrorHost(kind: MirrorKind): string {
  return MIRROR_HOSTS[kind];
}

const PATH_SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;

function safePathSegment(s: string): boolean {
  if (!PATH_SEGMENT.test(s) || s.startsWith("-")) return false;
  return s !== "." && s !== ".." && !s.includes("..");
}

export function mirrorPath(kind: MirrorKind, raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > MAX_URL) return null;
  if (HOSTILE.test(value)) return null;

  const prefix = `https://${MIRROR_HOSTS[kind]}/`;
  const bare = (
    value.toLowerCase().startsWith(prefix) ? value.slice(prefix.length) : value
  ).replace(/\/+$/, "");

  const parts = bare.split("/");
  if (parts.length !== 2) return null;

  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/, "");
  if (!safePathSegment(owner) || !safePathSegment(repo)) return null;

  return `${owner}/${repo}`;
}

export function mirrorUrl(kind: MirrorKind, raw: string): string | null {
  const path = mirrorPath(kind, raw);
  return path === null ? null : `https://${MIRROR_HOSTS[kind]}/${path}`;
}

export function mirrorSlug(kind: MirrorKind, url: string): string {
  const prefix = `https://${MIRROR_HOSTS[kind]}/`;
  return url.startsWith(prefix) ? url.slice(prefix.length) : url;
}

const DISCORD_HOSTS = [
  "discord.com",
  "discordapp.com",
  "canary.discord.com",
  "ptb.discord.com",
] as const;

const WEBHOOK_PATH = /^\/api(?:\/v\d{1,3})?\/webhooks\/\d{1,32}\/[A-Za-z0-9._-]{1,200}$/;

const WEBHOOK_PARAMS: Record<string, RegExp> = {
  thread_id: /^\d{1,32}$/,
  wait: /^(?:true|false)$/,
};

const WEBHOOK_PARAM_NAMES = Object.keys(WEBHOOK_PARAMS);

export function discordWebhookUrl(raw: string): string | null {
  const url = parseStrict(raw, DISCORD_HOSTS, WEBHOOK_PARAM_NAMES);
  if (!url) return null;
  if (!WEBHOOK_PATH.test(url.pathname)) return null;

  const params = new URLSearchParams();
  for (const name of WEBHOOK_PARAM_NAMES) {
    const value = url.searchParams.get(name);
    if (value === null) continue;
    if (!WEBHOOK_PARAMS[name]!.test(value)) return null;
    params.set(name, value);
  }

  const query = params.toString();
  return `https://${url.hostname}${url.pathname}${query ? `?${query}` : ""}`;
}

export function maskWebhook(url: string): string {
  const match = /^https:\/\/([^/]+)\/api(?:\/v\d+)?\/webhooks\/(\d+)\//.exec(url);
  if (!match) return "(hidden)";
  return `https://${match[1]}/api/webhooks/${match[2]}/…`;
}
