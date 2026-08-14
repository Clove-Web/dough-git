/* src/git.ts */
//
// Read-only helpers for the web viewer + repo management. Everything here shells
// out to the git CLI against bare repositories under config.reposRoot.
//
// Repos are namespaced GitHub-style: <reposRoot>/<owner>/<name>.git, addressed
// as `owner/name`. A RepoRef carries that identity through the whole module.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, access, writeFile, unlink, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.ts";

const exec = promisify(execFile);

// Separators in git's OUTPUT that we split on.
const NUL = "\x00";
const REC = "\x1e";

// The same separators as git pretty-format escapes, used in the --format
// argument (Node's child_process rejects literal NUL bytes in args; git expands
// %x00/%x1e into the real bytes in its output).
const FNUL = "%x00";
const FREC = "%x1e";

async function git(repoDir: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", repoDir, ...args], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: "utf8",
  });
  return stdout;
}

// ---- identity ---------------------------------------------------------------

export interface RepoRef {
  owner: string;
  name: string; // without .git
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

// A leading dot is refused outright: it covers `.` and `..` without special
// cases, and keeps hidden names out of the repos root.
function safeSegment(s: string): boolean {
  return SEGMENT.test(s) && !s.startsWith(".") && !s.includes("..");
}

// A git object id as it may appear in a URL. Anything else — notably anything
// starting with `-` — must never reach the git CLI as a bare argument, because
// git would read it as an option (`--output=<file>` writes a file).
const OBJECT_ID = /^[0-9a-fA-F]{4,64}$/;

export function safeObjectId(sha: string): string | null {
  return OBJECT_ID.test(sha) ? sha : null;
}

// Validate an owner + repo name into a RepoRef. `name` may carry a `.git`
// suffix (git clients send it); it's stripped. Returns null if either segment
// is unsafe, so a request can never escape the repos root.
export function safeRef(owner: string, nameRaw: string): RepoRef | null {
  const name = nameRaw.replace(/\.git$/, "");
  if (!safeSegment(owner) || !safeSegment(name)) return null;
  return { owner, name };
}

export function refDir(ref: RepoRef): string {
  return join(config.reposRoot, ref.owner, `${ref.name}.git`);
}

export function refSlug(ref: RepoRef): string {
  return `${ref.owner}/${ref.name}`;
}

// Turn a username/display name into a safe owner segment.
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

// ---- create / delete --------------------------------------------------------

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
  await initBareRepo(ref);
  return { ok: true, ref };
}

// Permanently delete a bare repo (guarded: must be a real repo first).
export async function deleteRepo(ref: RepoRef): Promise<boolean> {
  if (!(await repoExists(ref))) return false;
  await rm(refDir(ref), { recursive: true, force: true });
  // Drop the owner directory too if it's now empty.
  try {
    const ownerDir = join(config.reposRoot, ref.owner);
    if ((await readdir(ownerDir)).length === 0) {
      await rm(ownerDir, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
  return true;
}

// ---- visibility (filesystem marker) -----------------------------------------

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

// ---- listing ----------------------------------------------------------------

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
      continue; // not a directory (e.g. the sqlite db file)
    }
    for (const entry of entries) {
      if (!entry.endsWith(".git")) continue;
      const ref: RepoRef = { owner, name: entry.replace(/\.git$/, "") };
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
        /* skip invalid */
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

// ---- description ------------------------------------------------------------

// git's own one-line `description` file, which cgit and friends already read.
// Newlines are collapsed because the format is one line by convention and the
// whole viewer renders it as one.
const MAX_DESCRIPTION = 300;

export async function setDescription(ref: RepoRef, raw: string): Promise<void> {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION);
  const path = join(refDir(ref), "description");
  if (!text) {
    // git ships a placeholder here; restoring it is what "no description" means
    // to every other tool that reads this file.
    await writeFile(path, "Unnamed repository; edit this file to name it.\n");
    return;
  }
  await writeFile(path, `${text}\n`);
}

// ---- refs -------------------------------------------------------------------

export interface RefList {
  branches: string[];
  tags: string[];
  // The branch HEAD points at. Always the fallback when nothing is requested.
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

// Turn a requested revision into one that is safe to hand the git CLI.
//
// This is an allow-list, not a pattern check: the answer is either a ref this
// repo actually advertises or an object id that actually resolves, and anything
// else falls back to HEAD. That is what keeps a query string like
// `?h=--output=/etc/cron.d/x` from ever reaching an argv slot.
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

  // A full or abbreviated object id, so a commit link can be a permalink.
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

// ---- viewer reads -----------------------------------------------------------

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
    return []; // empty repo or bad ref
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
  // True when the file was too large to render and `text` holds only the head.
  truncated: boolean;
  bytes: number;
}

// Files above this are not rendered in full. A viewer page holds the whole blob
// in memory twice (raw + HTML-escaped), so an unbounded cap is a memory DoS any
// pusher can trigger.
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
  path: string; // the filename as committed, e.g. "ReadMe.md"
  text: string;
}

// README filenames we'll render, matched case-insensitively. An extensionless
// README is accepted too — it's still conventionally Markdown.
const README = /^readme(\.(?:md|markdown|mdown|mkd))?$/i;
const README_MD = /^readme\.(?:md|markdown|mdown|mkd)$/i;

// Fetch the README at the root of `refspec`'s tree. Prefers an explicit
// Markdown extension when a repo carries both `README` and `README.md`.
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

// The repo's `description` file (git's own), or "" when unset.
export async function description(ref: RepoRef): Promise<string> {
  return readDescription(refDir(ref));
}

export interface CommitDetail extends Commit {
  body: string;
  diff: string;
  diffTruncated: boolean;
}

export async function commit(ref: RepoRef, shaRaw: string): Promise<CommitDetail | null> {
  // `sha` lands in an argv slot, so it has to be an object id and nothing else.
  // Without this, `--output=<path>` reaches git show and writes a file as us.
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
