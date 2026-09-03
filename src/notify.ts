/* src/notify.ts
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

import {
  refSlug,
  logRange,
  isAncestor,
  type Commit,
  type RepoRef,
} from "./git.ts";
import { getSettings, recordWebhookResult } from "./settings.ts";
import { config } from "./config.ts";
import { discordWebhookUrl } from "./urls.ts";

const MAX_COMMITS_SHOWN = 10;
const MAX_REFS_SHOWN = 5;
const DELIVERY_TIMEOUT_MS = 5000;

const COLOUR_GOOD = 0xf5a9b8;
const COLOUR_WARN = 0xd15f8c;

export interface RefChange {
  ref: string;
  before: string | null;
  after: string | null;
  forced: boolean;
  commits: Commit[];
}

export async function diffRefs(
  repo: RepoRef,
  before: Map<string, string>,
  after: Map<string, string>,
): Promise<RefChange[]> {
  const names = new Set([...before.keys(), ...after.keys()]);
  const changes: RefChange[] = [];

  for (const ref of names) {
    const a = before.get(ref) ?? null;
    const b = after.get(ref) ?? null;
    if (a === b) continue;

    let forced = false;
    let commits: Commit[] = [];

    if (b === null) {
    } else if (a === null) {
      commits = await logRange(repo, null, b, MAX_COMMITS_SHOWN + 1);
    } else {
      forced = !(await isAncestor(repo, a, b));
      commits = await logRange(repo, forced ? null : a, b, MAX_COMMITS_SHOWN + 1);
    }
    changes.push({ ref, before: a, after: b, forced, commits });
  }

  changes.sort((x, y) => x.ref.localeCompare(y.ref));
  return changes;
}

export interface Embed {
  title: string;
  url?: string;
  description: string;
  color: number;
}

function shortRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, "").replace(/^refs\/tags\//, "tag ");
}

function repoUrl(repo: RepoRef): string {
  return `${config.baseUrl}/${repo.owner}/${repo.name}`;
}

function noMarkdown(s: string): string {
  return s.replace(/[\\`*_~|>[\]()#-]/g, "\\$&").replace(/\s+/g, " ").trim();
}

export function repoCreatedEmbed(repo: RepoRef, actor: string): Embed {
  return {
    title: `📁 ${refSlug(repo)} created`,
    url: repoUrl(repo),
    description: `by ${noMarkdown(actor)}`,
    color: COLOUR_GOOD,
  };
}

export function repoDeletedEmbed(repo: RepoRef, actor: string): Embed {
  return {
    title: `🗑️ ${refSlug(repo)} deleted`,
    description:
      `by ${noMarkdown(actor)} — recoverable from Recently Deleted until it is purged.`,
    color: COLOUR_WARN,
  };
}

export function pushEmbed(
  repo: RepoRef,
  actor: string,
  changes: RefChange[],
): Embed | null {
  if (changes.length === 0) return null;

  const forced = changes.some((ch) => ch.forced);
  const lines: string[] = [];

  for (const ch of changes.slice(0, MAX_REFS_SHOWN)) {
    const name = noMarkdown(shortRef(ch.ref));

    if (ch.after === null) {
      lines.push(`🔥 deleted \`${name}\``);
      continue;
    }
    if (ch.before === null) {
      lines.push(`✨ new \`${name}\``);
    } else if (ch.forced) {
      lines.push(`⚠️ force-pushed \`${name}\``);
    } else {
      lines.push(`\`${name}\``);
    }

    const shown = ch.commits.slice(0, MAX_COMMITS_SHOWN);
    for (const commit of shown) {
      const sha = commit.hash.slice(0, 7);
      lines.push(
        `  [\`${sha}\`](${repoUrl(repo)}/commit/${commit.hash}) ` +
          `${noMarkdown(commit.subject).slice(0, 100)} — ${noMarkdown(commit.author)}`,
      );
    }
    if (ch.commits.length > MAX_COMMITS_SHOWN) {
      lines.push(`  …and more`);
    }
  }
  if (changes.length > MAX_REFS_SHOWN) {
    lines.push(`…and ${changes.length - MAX_REFS_SHOWN} more refs`);
  }

  return {
    title: `${forced ? "⚠️ " : "⬆️ "}${refSlug(repo)} updated`,
    url: repoUrl(repo),
    description: `pushed by ${noMarkdown(actor)}\n${lines.join("\n")}`.slice(0, 4000),
    color: forced ? COLOUR_WARN : COLOUR_GOOD,
  };
}

async function deliver(owner: string, isPublic: boolean, embed: Embed | null): Promise<void> {
  if (!embed) return;

  const settings = getSettings(owner);
  if (!settings.discordWebhook) return;

  const target = discordWebhookUrl(settings.discordWebhook);
  if (!target) {
    recordWebhookResult(owner, "stored webhook is not a valid Discord URL");
    console.warn(`[notify] refusing to deliver for ${owner}: stored webhook failed validation`);
    return;
  }
  if (!isPublic && !settings.discordPrivate) return;

  try {
    const response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      redirect: "error",
    });
    if (!response.ok) {
      recordWebhookResult(owner, `HTTP ${response.status}`);
      console.warn(
        `[notify] discord delivery for ${owner} failed: HTTP ${response.status}`,
      );
      return;
    }
    recordWebhookResult(owner, null);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "TimeoutError"
          ? "timed out"
          : err.message.slice(0, 120)
        : "delivery failed";
    recordWebhookResult(owner, message);
    console.warn(`[notify] discord delivery for ${owner} failed: ${message}`);
  }
}

function fireAndForget(owner: string, isPublic: boolean, embed: Embed | null): void {
  void deliver(owner, isPublic, embed).catch((err) => {
    console.warn(`[notify] unexpected delivery error for ${owner}:`, err);
  });
}

export function notifyRepoCreated(repo: RepoRef, actor: string, isPublic: boolean): void {
  fireAndForget(repo.owner, isPublic, repoCreatedEmbed(repo, actor));
}

export function notifyRepoDeleted(repo: RepoRef, actor: string, isPublic: boolean): void {
  fireAndForget(repo.owner, isPublic, repoDeletedEmbed(repo, actor));
}

export function notifyPush(
  repo: RepoRef,
  actor: string,
  isPublic: boolean,
  before: Map<string, string>,
  after: Map<string, string>,
): void {
  void (async () => {
    try {
      const changes = await diffRefs(repo, before, after);
      if (changes.length === 0) return;
      fireAndForget(repo.owner, isPublic, pushEmbed(repo, actor, changes));
    } catch (err) {
      console.warn(`[notify] could not describe push to ${refSlug(repo)}:`, err);
    }
  })();
}
