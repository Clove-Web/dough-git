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

// allowedParams names the query parameters a caller is willing to consider.
// It is deliberately opt-in and empty by default, so every existing caller
// keeps the blanket "no query string" rule. Naming a parameter here only gets
// it past this gate — the caller still has to validate the value and rebuild
// the query itself, so nothing user-controlled is passed through verbatim.
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
      // A repeated key is ambiguous rather than useful; refuse instead of
      // silently picking one of the values.
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

// The two Discord webhook parameters worth honouring, each pinned to the exact
// shape its value may take. thread_id posts into an existing thread rather than
// the parent channel; wait=true makes Discord answer 200 + the created message
// instead of a bare 204, so a delivery that Discord rejects is reported as a
// failure rather than passing silently. Both stay inside notify.ts's
// `response.ok` check, which spans the whole 2xx range.
const WEBHOOK_PARAMS: Record<string, RegExp> = {
  thread_id: /^\d{1,32}$/,
  wait: /^(?:true|false)$/,
};

const WEBHOOK_PARAM_NAMES = Object.keys(WEBHOOK_PARAMS);

export function discordWebhookUrl(raw: string): string | null {
  const url = parseStrict(raw, DISCORD_HOSTS, WEBHOOK_PARAM_NAMES);
  if (!url) return null;
  if (!WEBHOOK_PATH.test(url.pathname)) return null;

  // Rebuild the query from validated values in a fixed order rather than
  // reusing url.search, so the stored URL is canonical and nothing the user
  // typed reaches fetch() unexamined.
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
