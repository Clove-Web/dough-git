/* src/urls.ts */
//
// URL validation, in one place, because these URLs are a security boundary.
//
// Two kinds of URL enter this application from a user, and both end up
// somewhere dangerous:
//
//   * mirror links (git.ts) are handed to the *git binary* as a remote to
//     contact, so a URL that isn't what it looks like becomes an outbound
//     request to somewhere we didn't intend, or another git transport
//     entirely (`ext::` runs a shell command).
//   * the Discord webhook (notify.ts) is handed to fetch(), so an unchecked
//     host makes the server into an SSRF probe for whatever it can reach.
//
// The defence in both cases is an allow-list of exact hosts rather than a
// sanitiser: there is a fixed, small set of places these URLs are allowed to
// point, so nothing else needs reasoning about. This is the same shape as
// markdown.ts's scheme allow-list and git.ts's `safeSegment`.
//
// Every validator returns a normalised URL string or null. Callers must treat
// null as "refuse", never as "use the raw value".

const MAX_URL = 400;

const HOSTILE = /[\s\\<>"'`{}|^\x00-\x1f\x7f]/;

function parseStrict(raw: string, allowedHosts: readonly string[]): URL | null {
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
  if (url.search || url.hash) return null;
  if (!allowedHosts.includes(url.hostname)) return null;
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

const PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;

function safePathSegment(s: string): boolean {
  return PATH_SEGMENT.test(s) && !s.startsWith(".") && !s.includes("..");
}

export function mirrorUrl(kind: MirrorKind, raw: string): string | null {
  const url = parseStrict(raw, [MIRROR_HOSTS[kind]]);
  if (!url) return null;

  const parts = url.pathname.split("/").filter((p) => p.length > 0);
  if (parts.length !== 2) return null;

  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/, "");
  if (!safePathSegment(owner) || !safePathSegment(repo)) return null;

  return `https://${url.hostname}/${owner}/${repo}`;
}

const DISCORD_HOSTS = [
  "discord.com",
  "discordapp.com",
  "canary.discord.com",
  "ptb.discord.com",
] as const;

const WEBHOOK_PATH = /^\/api(?:\/v\d{1,3})?\/webhooks\/\d{1,32}\/[A-Za-z0-9._-]{1,200}$/;

export function discordWebhookUrl(raw: string): string | null {
  const url = parseStrict(raw, DISCORD_HOSTS);
  if (!url) return null;
  if (!WEBHOOK_PATH.test(url.pathname)) return null;
  return `https://${url.hostname}${url.pathname}`;
}

export function maskWebhook(url: string): string {
  const match = /^https:\/\/([^/]+)\/api(?:\/v\d+)?\/webhooks\/(\d+)\//.exec(url);
  if (!match) return "(hidden)";
  return `https://${match[1]}/api/webhooks/${match[2]}/…`;
}
