/* src/git.ts */
//
// Read-only helpers for the web viewer + repo management. Everything here shells
// out to the git CLI against bare repositories under config.reposRoot.
//
// Repos are namespaced GitHub-style: <reposRoot>/<owner>/<name>.git, addressed
// as `owner/name`. A RepoRef carries that identity through the whole module.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readdir,
  readFile,
  access,
  writeFile,
  unlink,
  mkdir,
  rm,
  rename,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { config } from "./config.ts";
import { isMirrorKind, mirrorUrl, MIRROR_KINDS, type MirrorKind } from "./urls.ts";

const exec = promisify(execFile);

const NUL = "\x00";
const REC = "\x1e";

const FNUL = "%x00";
const FREC = "%x1e";

async function git(repoDir: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", repoDir, ...args], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: "utf8",
  });
  return stdout;
}

export interface RepoRef {
  owner: string;
  name: string;
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

function safeSegment(s: string): boolean {
  return SEGMENT.test(s) && !s.startsWith(".") && !s.includes("..");
}

// The "+" namespace.
//
// A leading "+" marks a name the forge owns rather than the user. It buys two
// things at once: route segments like /:owner/+repos can never collide with a
// real repository, and the profile repo cannot be created by accident or
// squatted by someone typing a plausible name.
//
// Exactly one "+" name is a real repository — PROFILE_REPO, whose README is
// rendered on its owner's profile page. Every other "+" name is refused
// everywhere a name is accepted, so `git push` cannot conjure one and neither
// can the create form. "+" is not allowed anywhere else in a name, which keeps
// the prefix a namespace marker rather than a character.
export const PROFILE_REPO = "+dough";

// The owner-level repositories page lives at /<owner>/+repos. It is a route,
// not a repository, and it is deliberately spelled with the reserved prefix:
// safeName() refuses every "+" name but PROFILE_REPO, so no repository can ever
// exist that would answer to this URL.
export const PROFILE_REPOS_PATH = "+repos";

const NAME_SEGMENT = /^[A-Za-z0-9._+-]+$/;

function safeName(s: string): boolean {
  if (!NAME_SEGMENT.test(s) || s.startsWith(".") || s.includes("..")) return false;
  if (s.startsWith("+")) return s === PROFILE_REPO;
  return !s.includes("+");
}

export function isProfileRepo(name: string): boolean {
  return name === PROFILE_REPO;
}

const OBJECT_ID = /^[0-9a-fA-F]{4,64}$/;

export function safeObjectId(sha: string): string | null {
  return OBJECT_ID.test(sha) ? sha : null;
}

export function safeRef(owner: string, nameRaw: string): RepoRef | null {
  const name = nameRaw.replace(/\.git$/, "");
  if (!safeSegment(owner) || !safeName(name)) return null;
  return { owner, name };
}

export function refDir(ref: RepoRef): string {
  return join(config.reposRoot, ref.owner, `${ref.name}.git`);
}

export function refSlug(ref: RepoRef): string {
  return `${ref.owner}/${ref.name}`;
}

export function ownerSlug(raw: string): string {
  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "user";
}

export async function repoExists(ref: RepoRef): Promise<boolean> {
  try {
    await access(join(refDir(ref), "HEAD"));
    return true;
  } catch {
    return false;
  }
}

export async function initBareRepo(ref: RepoRef): Promise<void> {
  const dir = refDir(ref);
  await mkdir(dir, { recursive: true });
  await exec("git", ["init", "--bare", "--initial-branch=main", dir], {
    encoding: "utf8",
  });
}

export interface CreateResult {
  ok: boolean;
  ref?: RepoRef;
  error?: string;
  reserved?: boolean;
}

export async function createRepo(
  owner: string,
  nameRaw: string,
): Promise<CreateResult> {
  const ref = safeRef(owner, nameRaw);
  if (!ref) {
    return { ok: false, error: "invalid name — use letters, digits, . _ -" };
  }
  if (await repoExists(ref)) {
    return { ok: false, error: "a repo with that name already exists" };
  }
  if (await trashHasName(ref.owner, ref.name)) {
    return {
      ok: false,
      error:
        `${ref.owner}/${ref.name} is in Recently Deleted and still holds that name. ` +
        `Restore it, or delete it permanently, from your settings.`,
      reserved: true,
    };
  }
  await initBareRepo(ref);
  return { ok: true, ref };
}

async function pruneEmptyDir(dir: string): Promise<void> {
  try {
    if ((await readdir(dir)).length === 0) {
      await rm(dir, { recursive: true, force: true });
    }
  } catch {
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const TRASH_DIR = ".trash";

export const DELETED_META = "dough-deleted.json";

const TRASH_ENTRY = /^\+?[A-Za-z0-9._-]+\.\d+\.git$/;

export interface DeletedGrant {
  slug: string;
  level: string;
}

export interface DeletedMeta {
  version: 1;
  owner: string;
  name: string;
  deletedAt: number;
  deletedBy: string;
  grants: DeletedGrant[];
}

export interface TrashEntry {
  entry: string;
  owner: string;
  name: string;
  deletedAt: number;
  deletedBy: string;
  grants: DeletedGrant[];
  degraded: boolean;
}

function trashRoot(): string {
  return join(config.reposRoot, TRASH_DIR);
}

function trashOwnerDir(owner: string): string {
  return join(trashRoot(), owner);
}

function trashEntryDir(owner: string, entry: string): string | null {
  if (!safeSegment(owner)) return null;
  if (entry.startsWith(".") || entry.includes("/") || entry.includes("\\")) {
    return null;
  }
  if (!TRASH_ENTRY.test(entry)) return null;
  if (!safeName(nameFromEntry(entry))) return null;

  const root = resolve(trashRoot());
  const full = resolve(join(root, owner, entry));
  if (!full.startsWith(root + sep)) return null;
  return full;
}

function nameFromEntry(entry: string): string {
  return entry.replace(/\.\d+\.git$/, "");
}

export async function trashRepo(
  ref: RepoRef,
  meta: Omit<DeletedMeta, "version" | "owner" | "name">,
): Promise<{ ok: boolean; entry?: string; error?: string }> {
  if (!(await repoExists(ref))) return { ok: false, error: "no such repository" };

  const ownerDir = trashOwnerDir(ref.owner);
  await mkdir(ownerDir, { recursive: true });

  let stamp = meta.deletedAt;
  let entry = `${ref.name}.${stamp}.git`;
  while (await pathExists(join(ownerDir, entry))) {
    stamp += 1;
    entry = `${ref.name}.${stamp}.git`;
  }

  const full: DeletedMeta = {
    version: 1,
    owner: ref.owner,
    name: ref.name,
    deletedAt: meta.deletedAt,
    deletedBy: meta.deletedBy,
    grants: meta.grants,
  };
  await writeFile(
    join(refDir(ref), DELETED_META),
    JSON.stringify(full, null, 2) + "\n",
  );

  await rename(refDir(ref), join(ownerDir, entry));
  await pruneEmptyDir(join(config.reposRoot, ref.owner));
  return { ok: true, entry };
}

export async function listTrash(owner: string): Promise<TrashEntry[]> {
  if (!safeSegment(owner)) return [];
  let entries: string[];
  try {
    entries = await readdir(trashOwnerDir(owner));
  } catch {
    return [];
  }

  const out: TrashEntry[] = [];
  for (const entry of entries) {
    const dir = trashEntryDir(owner, entry);
    if (!dir) continue;

    const fallbackTime = Number(/\.(\d+)\.git$/.exec(entry)?.[1] ?? 0);
    let meta: DeletedMeta | null = null;
    try {
      const parsed = JSON.parse(await readFile(join(dir, DELETED_META), "utf8"));
      if (
        parsed &&
        typeof parsed.name === "string" &&
        safeName(parsed.name) &&
        parsed.owner === owner
      ) {
        meta = parsed as DeletedMeta;
      }
    } catch {
    }

    out.push({
      entry,
      owner,
      name: meta?.name ?? nameFromEntry(entry),
      deletedAt: meta?.deletedAt ?? fallbackTime,
      deletedBy: meta?.deletedBy ?? "unknown",
      grants: Array.isArray(meta?.grants) ? meta.grants : [],
      degraded: meta === null,
    });
  }

  out.sort((a, b) => b.deletedAt - a.deletedAt);
  return out;
}

export async function trashHasName(owner: string, name: string): Promise<boolean> {
  const entries = await listTrash(owner);
  return entries.some((e) => e.name === name);
}

export interface RestoreResult {
  ok: boolean;
  error?: string;
  meta?: TrashEntry;
}

export async function restoreFromTrash(
  owner: string,
  entry: string,
): Promise<RestoreResult> {
  const dir = trashEntryDir(owner, entry);
  if (!dir || !(await pathExists(dir))) {
    return { ok: false, error: "no such deleted repository" };
  }

  const all = await listTrash(owner);
  const found = all.find((e) => e.entry === entry);
  if (!found) return { ok: false, error: "no such deleted repository" };

  const ref = safeRef(owner, found.name);
  if (!ref) return { ok: false, error: "that repository's name is not usable" };
  if (await repoExists(ref)) {
    return {
      ok: false,
      error: `${owner}/${found.name} already exists. Rename or delete it first, then restore.`,
    };
  }

  await mkdir(join(config.reposRoot, owner), { recursive: true });
  await rename(dir, refDir(ref));
  await unlink(join(refDir(ref), DELETED_META)).catch(() => {});
  await pruneEmptyDir(trashOwnerDir(owner));
  return { ok: true, meta: found };
}

export async function purgeFromTrash(
  owner: string,
  entry: string,
): Promise<boolean> {
  const dir = trashEntryDir(owner, entry);
  if (!dir) return false;
  if (!(await pathExists(dir))) return false;
  await rm(dir, { recursive: true, force: true });
  await pruneEmptyDir(trashOwnerDir(owner));
  return true;
}

export async function purgeExpired(owner: string): Promise<TrashEntry[]> {
  if (config.trashDays <= 0) return [];
  const cutoff = Math.floor(Date.now() / 1000) - config.trashDays * 86400;
  const purged: TrashEntry[] = [];
  for (const entry of await listTrash(owner)) {
    if (entry.degraded || entry.deletedAt <= 0) continue;
    if (entry.deletedAt >= cutoff) continue;
    if (await purgeFromTrash(owner, entry.entry)) purged.push(entry);
  }
  return purged;
}

// Retention across every owner.
//
// purgeExpired() only sweeps the owner whose page is being rendered, which
// makes MINIGIT_TRASH_DAYS a promise that is only kept for people who happen to
// visit. This is the sweep the server runs on a timer so the retention window
// means what it says.
export async function purgeAllExpired(): Promise<TrashEntry[]> {
  if (config.trashDays <= 0) return [];

  let owners: string[];
  try {
    owners = await readdir(trashRoot());
  } catch {
    return [];
  }

  const purged: TrashEntry[] = [];
  for (const owner of owners) {
    if (!safeSegment(owner)) continue;
    purged.push(...(await purgeExpired(owner)));
  }
  return purged;
}

export async function isRepoPublic(ref: RepoRef): Promise<boolean> {
  try {
    await access(join(refDir(ref), config.publicMarker));
    return true;
  } catch {
    return false;
  }
}

export async function setRepoPublic(ref: RepoRef, isPublic: boolean): Promise<void> {
  const marker = join(refDir(ref), config.publicMarker);
  if (isPublic) await writeFile(marker, "");
  else await unlink(marker).catch(() => {});
}

export interface RepoSummary {
  owner: string;
  name: string;
  description: string;
  head: string;
  lastCommit: number | null;
  isPublic: boolean;
}

export async function listRepos(): Promise<RepoSummary[]> {
  let owners: string[];
  try {
    owners = await readdir(config.reposRoot);
  } catch {
    return [];
  }

  const repos: RepoSummary[] = [];
  for (const owner of owners) {
    if (!safeSegment(owner)) continue;
    let entries: string[];
    try {
      entries = await readdir(join(config.reposRoot, owner));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".git")) continue;
      const name = entry.replace(/\.git$/, "");
      if (!safeName(name)) continue;
      const ref: RepoRef = { owner, name };
      const dir = refDir(ref);
      try {
        repos.push({
          owner,
          name: ref.name,
          description: await readDescription(dir),
          head: await headBranch(dir),
          lastCommit: await lastCommitTime(dir),
          isPublic: await isRepoPublic(ref),
        });
      } catch {
      }
    }
  }

  repos.sort((a, b) => (b.lastCommit ?? 0) - (a.lastCommit ?? 0));
  return repos;
}

async function readDescription(dir: string): Promise<string> {
  try {
    const text = (await readFile(join(dir, "description"), "utf8")).trim();
    if (text.startsWith("Unnamed repository")) return "";
    return text;
  } catch {
    return "";
  }
}

async function headBranch(dir: string): Promise<string> {
  try {
    return (await git(dir, ["symbolic-ref", "--short", "HEAD"])).trim();
  } catch {
    return "main";
  }
}

const MAX_DESCRIPTION = 300;

export async function setDescription(ref: RepoRef, raw: string): Promise<void> {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION);
  const path = join(refDir(ref), "description");
  if (!text) {
    await writeFile(path, "Unnamed repository; edit this file to name it.\n");
    return;
  }
  await writeFile(path, `${text}\n`);
}

const REMOTE_TIMEOUT_MS = 10_000;
const REMOTE_MAX_BYTES = 1024 * 1024;

const REMOTE_HARDENING = [
  "-c", "protocol.allow=never",
  "-c", "protocol.https.allow=always",
  "-c", "credential.helper=",
  "-c", "http.followRedirects=false",
  "-c", "http.lowSpeedLimit=1000",
  "-c", "http.lowSpeedTime=15",
];

const REMOTE_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: "/nonexistent",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "/bin/true",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  LC_ALL: "C",
};

export type RemoteFailure = "denied" | "missing" | "error";

export type LsRemoteResult =
  | { ok: true; text: string }
  | { ok: false; kind: RemoteFailure; message: string };

export function classifyRemoteError(stderr: string, timedOut: boolean): {
  kind: RemoteFailure;
  message: string;
} {
  if (timedOut) return { kind: "error", message: "timed out" };

  const text = stderr.trim();
  const first =
    text
      .split("\n")
      .map((l) => l.replace(/^(?:fatal|error|warning|remote):\s*/i, "").trim())
      .filter((l) => l.length > 0)
      .pop() ?? "unknown error";
  const short = first.slice(0, 160);

  if (/terminal prompts disabled|could not read Username|Authentication failed|403/i.test(text)) {
    return { kind: "denied", message: short };
  }
  if (/repository not found|not found|404/i.test(text)) {
    return { kind: "missing", message: short };
  }
  return { kind: "error", message: short };
}

export async function lsRemote(url: string): Promise<LsRemoteResult> {
  try {
    const { stdout } = await exec(
      "git",
      [...REMOTE_HARDENING, "ls-remote", "--heads", "--tags", "--", url],
      {
        timeout: REMOTE_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: REMOTE_MAX_BYTES,
        encoding: "utf8",
        env: REMOTE_ENV,
        windowsHide: true,
      },
    );
    return { ok: true, text: stdout };
  } catch (err) {
    const e = err as { stderr?: string; killed?: boolean; signal?: string; message?: string };
    const timedOut = e.killed === true || e.signal === "SIGKILL";
    return {
      ok: false,
      ...classifyRemoteError(e.stderr ?? e.message ?? "", timedOut),
    };
  }
}

export async function localMirrorRefs(ref: RepoRef): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const text = await git(refDir(ref), [
      "for-each-ref",
      "--format=%(objectname) %(refname)",
      "refs/heads",
      "refs/tags",
    ]);
    for (const line of text.split("\n")) {
      const space = line.indexOf(" ");
      if (space === -1) continue;
      const sha = line.slice(0, space);
      const name = line.slice(space + 1).trim();
      if (safeObjectId(sha) && name) out.set(name, sha);
    }
  } catch {
  }
  return out;
}

export async function hasCommit(ref: RepoRef, sha: string): Promise<boolean> {
  const id = safeObjectId(sha);
  if (!id) return false;
  try {
    await git(refDir(ref), ["cat-file", "-e", `${id}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

export async function isAncestor(
  ref: RepoRef,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  const a = safeObjectId(ancestor);
  const b = safeObjectId(descendant);
  if (!a || !b) return false;
  try {
    await git(refDir(ref), ["merge-base", "--is-ancestor", a, b]);
    return true;
  } catch {
    return false;
  }
}

const LINKS_FILE = "dough-links";

const MAX_LINKS_BYTES = 2048;
const MAX_LINK_LINES = 16;

export interface MirrorLink {
  kind: MirrorKind;
  url: string;
  isPrivate: boolean;
}

export function parseLinks(text: string): MirrorLink[] {
  const out: MirrorLink[] = [];
  const seen = new Set<string>();

  for (const raw of text.split("\n").slice(0, MAX_LINK_LINES)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split(/\s+/);
    const kind = (parts[0] ?? "").toLowerCase();
    const url = parts[1] ?? "";
    if (!isMirrorKind(kind)) continue;
    if (seen.has(kind)) continue;

    const valid = mirrorUrl(kind, url);
    if (!valid) continue;

    seen.add(kind);
    out.push({
      kind,
      url: valid,
      isPrivate: parts.slice(2).includes("private"),
    });
  }

  out.sort((a, b) => MIRROR_KINDS.indexOf(a.kind) - MIRROR_KINDS.indexOf(b.kind));
  return out;
}

export function serialiseLinks(links: MirrorLink[]): string {
  return links
    .map((l) => `${l.kind} ${l.url}${l.isPrivate ? " private" : ""}`)
    .join("\n");
}

export async function readLinks(ref: RepoRef): Promise<MirrorLink[]> {
  try {
    const text = await readFile(join(refDir(ref), LINKS_FILE), "utf8");
    return parseLinks(text.slice(0, MAX_LINKS_BYTES));
  } catch {
    return [];
  }
}

export async function setLinks(ref: RepoRef, links: MirrorLink[]): Promise<void> {
  const path = join(refDir(ref), LINKS_FILE);
  const valid = parseLinks(serialiseLinks(links));
  if (valid.length === 0) {
    await unlink(path).catch(() => {});
    return;
  }
  await writeFile(path, serialiseLinks(valid) + "\n");
}

export interface RefList {
  branches: string[];
  tags: string[];
  head: string;
}

export async function listRefs(ref: RepoRef): Promise<RefList> {
  const dir = refDir(ref);
  const head = await headBranch(dir);

  const read = async (namespace: string): Promise<string[]> => {
    try {
      const out = await git(dir, [
        "for-each-ref",
        "--format=%(refname:short)",
        "--sort=-creatordate",
        namespace,
      ]);
      return out.split("\n").filter((line) => line.trim().length > 0);
    } catch {
      return [];
    }
  };

  return {
    branches: await read("refs/heads"),
    tags: await read("refs/tags"),
    head,
  };
}

export async function resolveRev(
  ref: RepoRef,
  requested: string | undefined,
  known?: RefList,
): Promise<string> {
  const refs = known ?? (await listRefs(ref));
  const fallback = refs.head;

  const wanted = (requested ?? "").trim();
  if (!wanted) return fallback;
  if (refs.branches.includes(wanted) || refs.tags.includes(wanted)) return wanted;

  const sha = safeObjectId(wanted);
  if (sha) {
    try {
      await git(refDir(ref), ["cat-file", "-e", `${sha}^{commit}`]);
      return sha;
    } catch {
      return fallback;
    }
  }

  return fallback;
}

async function lastCommitTime(dir: string): Promise<number | null> {
  try {
    const out = (await git(dir, ["log", "-1", "--format=%at"])).trim();
    return out ? Number(out) : null;
  } catch {
    return null;
  }
}

export interface Commit {
  hash: string;
  author: string;
  email: string;
  time: number;
  subject: string;
}

export async function log(ref: RepoRef, refspec: string, limit = 50): Promise<Commit[]> {
  const dir = refDir(ref);
  const format = ["%H", "%an", "%ae", "%at", "%s"].join(FNUL);
  let out: string;
  try {
    out = await git(dir, [
      "log",
      `--max-count=${limit}`,
      `--format=${format}${FREC}`,
      refspec,
      "--",
    ]);
  } catch {
    return [];
  }
  return out
    .split(REC)
    .map((row) => row.replace(/^\n/, ""))
    .filter((row) => row.trim().length > 0)
    .map((row) => {
      const [hash, author, email, time, subject] = row.split(NUL);
      return {
        hash: hash ?? "",
        author: author ?? "",
        email: email ?? "",
        time: Number(time ?? 0),
        subject: subject ?? "",
      };
    });
}

export async function logRange(
  ref: RepoRef,
  from: string | null,
  to: string,
  limit: number,
): Promise<Commit[]> {
  const toId = safeObjectId(to);
  if (!toId) return [];
  const fromId = from ? safeObjectId(from) : null;
  if (from && !fromId) return [];

  const dir = refDir(ref);
  const format = ["%H", "%an", "%ae", "%at", "%s"].join(FNUL);
  let out: string;
  try {
    out = await git(dir, [
      "log",
      `--max-count=${Math.max(1, Math.floor(limit))}`,
      `--format=${format}${FREC}`,
      ...(fromId ? [`${fromId}..${toId}`] : [toId]),
      "--",
    ]);
  } catch {
    return [];
  }
  return out
    .split(REC)
    .map((row) => row.replace(/^\n/, ""))
    .filter((row) => row.trim().length > 0)
    .map((row) => {
      const [hash, author, email, time, subject] = row.split(NUL);
      return {
        hash: hash ?? "",
        author: author ?? "",
        email: email ?? "",
        time: Number(time ?? 0),
        subject: subject ?? "",
      };
    });
}

export interface TreeEntry {
  mode: string;
  type: "blob" | "tree" | "commit";
  hash: string;
  size: string;
  name: string;
}

export async function tree(ref: RepoRef, refspec: string, path: string): Promise<TreeEntry[]> {
  const dir = refDir(ref);
  const spec = path ? `${refspec}:${path}` : refspec;
  let out: string;
  try {
    out = await git(dir, ["ls-tree", "--long", spec, "--"]);
  } catch {
    return [];
  }
  return out
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [meta, entryName] = line.split("\t");
      const [mode, type, hash, size] = (meta ?? "").split(/\s+/);
      return {
        mode: mode ?? "",
        type: (type ?? "blob") as TreeEntry["type"],
        hash: hash ?? "",
        size: size ?? "-",
        name: entryName ?? "",
      };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export interface Blob {
  text: string;
  binary: boolean;
  truncated: boolean;
  bytes: number;
}

const MAX_BLOB_RENDER_BYTES = 2 * 1024 * 1024;

export async function blob(ref: RepoRef, refspec: string, path: string): Promise<Blob | null> {
  const dir = refDir(ref);
  let stdout: Buffer;
  try {
    ({ stdout } = (await exec(
      "git",
      ["-C", dir, "show", `${refspec}:${path}`, "--"],
      {
        maxBuffer: 64 * 1024 * 1024,
        encoding: "buffer",
      },
    )) as unknown as { stdout: Buffer });
  } catch {
    return null;
  }

  const bytes = stdout.length;
  const binary = stdout.subarray(0, 8000).includes(0);
  if (binary) {
    return { text: "", binary: true, truncated: false, bytes };
  }

  const truncated = bytes > MAX_BLOB_RENDER_BYTES;
  const shown = truncated ? stdout.subarray(0, MAX_BLOB_RENDER_BYTES) : stdout;
  return {
    text: shown.toString("utf8"),
    binary: false,
    truncated,
    bytes,
  };
}

export interface Readme {
  path: string;
  text: string;
}

const README = /^readme(\.(?:md|markdown|mdown|mkd))?$/i;
const README_MD = /^readme\.(?:md|markdown|mdown|mkd)$/i;

export async function readme(ref: RepoRef, refspec: string): Promise<Readme | null> {
  const entries = await tree(ref, refspec, "");
  const blobs = entries.filter((e) => e.type === "blob");
  const hit =
    blobs.find((e) => README_MD.test(e.name)) ?? blobs.find((e) => README.test(e.name));
  if (!hit) return null;
  const content = await blob(ref, refspec, hit.name);
  if (!content || content.binary) return null;
  return { path: hit.name, text: content.text };
}

// The README at a repo's default branch, for callers that want it without
// caring which revision they are on. tree() already swallows a bad refspec and
// returns nothing, so an empty repo, a dangling HEAD and a repo with no README
// all arrive here as the same null.
export async function headReadme(ref: RepoRef): Promise<Readme | null> {
  const refs = await listRefs(ref);
  if (refs.branches.length === 0) return null;
  const rev = refs.branches.includes(refs.head) ? refs.head : refs.branches[0]!;
  return readme(ref, rev);
}

export async function description(ref: RepoRef): Promise<string> {
  return readDescription(refDir(ref));
}

export interface CommitDetail extends Commit {
  body: string;
  diff: string;
  diffTruncated: boolean;
}

export async function commit(ref: RepoRef, shaRaw: string): Promise<CommitDetail | null> {
  const sha = safeObjectId(shaRaw);
  if (!sha) return null;

  const dir = refDir(ref);
  const format = ["%H", "%an", "%ae", "%at", "%s", "%b"].join(FNUL);
  let out: string;
  try {
    out = await git(dir, [
      "show",
      `--format=${format}${FREC}`,
      "--patch",
      sha,
      "--",
    ]);
  } catch {
    return null;
  }

  const sep = out.indexOf(REC);
  if (sep === -1) return null;
  const [hash, author, email, time, subject, body] = out.slice(0, sep).split(NUL);

  const fullDiff = out.slice(sep + 1).replace(/^\n/, "");
  const diffTruncated = fullDiff.length > MAX_BLOB_RENDER_BYTES;

  return {
    hash: hash ?? "",
    author: author ?? "",
    email: email ?? "",
    time: Number(time ?? 0),
    subject: subject ?? "",
    body: body ?? "",
    diff: diffTruncated ? fullDiff.slice(0, MAX_BLOB_RENDER_BYTES) : fullDiff,
    diffTruncated,
  };
}
