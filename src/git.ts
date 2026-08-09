// Read-only helpers for the web viewer. Everything here shells out to the git
// CLI against bare repositories under config.reposRoot. Output is parsed into
// plain objects the HTML views can render.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, access, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.ts";

const exec = promisify(execFile);

const NUL = "\x00";
const REC = "\x1e"; // record separator between log entries

// Run git inside a repo directory, returning stdout. Large buffers are allowed
// so blobs / diffs don't get truncated.
async function git(repoDir: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", repoDir, ...args], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: "utf8",
  });
  return stdout;
}

// A repo name must be a single path segment ending in `.git`, with no `..` or
// slashes, so a request can never escape the repos root.
export function safeRepoName(name: string): string | null {
  const clean = name.endsWith(".git") ? name : `${name}.git`;
  if (!/^[A-Za-z0-9._-]+\.git$/.test(clean)) return null;
  if (clean.includes("..")) return null;
  return clean;
}

export function repoDir(name: string): string | null {
  const clean = safeRepoName(name);
  if (!clean) return null;
  return join(config.reposRoot, clean);
}

export async function repoExists(name: string): Promise<boolean> {
  const dir = repoDir(name);
  if (!dir) return false;
  try {
    await access(join(dir, "HEAD"));
    return true;
  } catch {
    return false;
  }
}

// Visibility is a filesystem marker inside the bare repo. Absent = private,
// so a freshly pushed repo is never accidentally public.
export async function isRepoPublic(name: string): Promise<boolean> {
  const dir = repoDir(name);
  if (!dir) return false;
  try {
    await access(join(dir, config.publicMarker));
    return true;
  } catch {
    return false;
  }
}

export async function setRepoPublic(
  name: string,
  isPublic: boolean,
): Promise<void> {
  const dir = repoDir(name);
  if (!dir) return;
  const marker = join(dir, config.publicMarker);
  if (isPublic) {
    await writeFile(marker, "");
  } else {
    await unlink(marker).catch(() => {});
  }
}

export interface RepoSummary {
  name: string; // without .git
  description: string;
  head: string; // current branch
  lastCommit: number | null; // unix seconds
  isPublic: boolean;
}

// Scan the repos root for bare repositories (`*.git` directories).
export async function listRepos(): Promise<RepoSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(config.reposRoot);
  } catch {
    return [];
  }

  const repos: RepoSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".git")) continue;
    const dir = join(config.reposRoot, entry);
    try {
      const description = await readDescription(dir);
      const head = await headBranch(dir);
      const lastCommit = await lastCommitTime(dir);
      const name = entry.replace(/\.git$/, "");
      repos.push({
        name,
        description,
        head,
        lastCommit,
        isPublic: await isRepoPublic(name),
      });
    } catch {
      // Not a valid repo dir; skip.
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

export async function log(
  name: string,
  ref: string,
  limit = 50,
): Promise<Commit[]> {
  const dir = repoDir(name);
  if (!dir) return [];
  const format = ["%H", "%an", "%ae", "%at", "%s"].join(NUL);
  const out = await git(dir, [
    "log",
    `--max-count=${limit}`,
    `--format=${format}${REC}`,
    ref,
    "--",
  ]);
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
  size: string; // "-" for trees
  name: string;
}

export async function tree(
  name: string,
  ref: string,
  path: string,
): Promise<TreeEntry[]> {
  const dir = repoDir(name);
  if (!dir) return [];
  const spec = path ? `${ref}:${path}` : ref;
  const out = await git(dir, ["ls-tree", "--long", spec]);
  return out
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      // <mode> SP <type> SP <hash> SP* <size> TAB <name>
      const [meta, entryName] = line.split("\t");
      const parts = (meta ?? "").split(/\s+/);
      const [mode, type, hash, size] = parts;
      return {
        mode: mode ?? "",
        type: (type ?? "blob") as TreeEntry["type"],
        hash: hash ?? "",
        size: size ?? "-",
        name: entryName ?? "",
      };
    })
    .sort((a, b) => {
      // Directories first, then alphabetical.
      if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export interface Blob {
  text: string;
  binary: boolean;
}

export async function blob(
  name: string,
  ref: string,
  path: string,
): Promise<Blob | null> {
  const dir = repoDir(name);
  if (!dir) return null;
  const { stdout } = await exec("git", ["-C", dir, "show", `${ref}:${path}`], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: "buffer",
  });
  const buf = stdout as unknown as Buffer;
  const binary = buf.subarray(0, 8000).includes(0);
  return {
    text: binary ? "" : buf.toString("utf8"),
    binary,
  };
}

export interface CommitDetail extends Commit {
  body: string;
  diff: string;
}

export async function commit(
  name: string,
  sha: string,
): Promise<CommitDetail | null> {
  const dir = repoDir(name);
  if (!dir) return null;
  const format = ["%H", "%an", "%ae", "%at", "%s", "%b"].join(NUL);
  const out = await git(dir, [
    "show",
    `--format=${format}${REC}`,
    "--patch",
    sha,
  ]);
  const sep = out.indexOf(REC);
  if (sep === -1) return null;
  const meta = out.slice(0, sep).split(NUL);
  const diff = out.slice(sep + 1).replace(/^\n/, "");
  const [hash, author, email, time, subject, body] = meta;
  return {
    hash: hash ?? "",
    author: author ?? "",
    email: email ?? "",
    time: Number(time ?? 0),
    subject: subject ?? "",
    body: body ?? "",
    diff,
  };
}

export async function branches(name: string): Promise<string[]> {
  const dir = repoDir(name);
  if (!dir) return [];
  try {
    const out = await git(dir, [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
    ]);
    return out.split("\n").filter((b) => b.trim().length > 0);
  } catch {
    return [];
  }
}
