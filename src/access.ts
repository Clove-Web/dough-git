/* src/access.ts */
//
// Who may read and write a repository.
//
// Two things decide it. The filesystem marker (git.ts) says whether a repo is
// world-readable, and this table says who else — beyond the owner — was invited
// in. The owner always has write; nobody else gets write without being named
// here; and a private repo is invisible to everyone who isn't.
//
// Every entry addresses a repo by `owner/name` rather than by a row id, because
// that is the identity the filesystem already uses. Deleting a repo drops its
// rows (see dropRepoAccess), so a later repo of the same name starts clean.

import { db, now } from "./db.ts";
import type { RepoRef } from "./git.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS collaborators (
    owner    TEXT NOT NULL,
    repo     TEXT NOT NULL,
    slug     TEXT NOT NULL,
    level    TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (owner, repo, slug)
  );
`);

export type Level = "read" | "write";

export type Access = "none" | "read" | "write";

export function isLevel(value: string): value is Level {
  return value === "read" || value === "write";
}

export interface CollaboratorRow {
  slug: string;
  level: Level;
  added_at: number;
}

export function listCollaborators(ref: RepoRef): CollaboratorRow[] {
  return db
    .prepare(
      `SELECT slug, level, added_at
       FROM collaborators
       WHERE owner = ? AND repo = ?
       ORDER BY slug`,
    )
    .all(ref.owner, ref.name) as unknown as CollaboratorRow[];
}

export function setCollaborator(
  ref: RepoRef,
  slug: string,
  level: Level,
): boolean {
  if (!slug || slug === ref.owner) return false;
  db.prepare(
    `INSERT INTO collaborators (owner, repo, slug, level, added_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (owner, repo, slug) DO UPDATE SET level = excluded.level`,
  ).run(ref.owner, ref.name, slug, level, now());
  return true;
}

export function removeCollaborator(ref: RepoRef, slug: string): boolean {
  const result = db
    .prepare("DELETE FROM collaborators WHERE owner = ? AND repo = ? AND slug = ?")
    .run(ref.owner, ref.name, slug);
  return Number(result.changes) > 0;
}

export function dropRepoAccess(ref: RepoRef): void {
  db.prepare("DELETE FROM collaborators WHERE owner = ? AND repo = ?").run(
    ref.owner,
    ref.name,
  );
}

export function collaboratorLevel(ref: RepoRef, slug: string): Level | null {
  const row = db
    .prepare(
      "SELECT level FROM collaborators WHERE owner = ? AND repo = ? AND slug = ?",
    )
    .get(ref.owner, ref.name, slug) as { level: string } | undefined;
  if (!row || !isLevel(row.level)) return null;
  return row.level;
}

export interface SharedRepo {
  owner: string;
  name: string;
  level: Level;
}

export function sharedWith(slug: string): SharedRepo[] {
  const rows = db
    .prepare(
      `SELECT owner, repo AS name, level
       FROM collaborators
       WHERE slug = ?`,
    )
    .all(slug) as unknown as { owner: string; name: string; level: string }[];
  return rows
    .filter((row) => isLevel(row.level))
    .map((row) => ({
      owner: row.owner,
      name: row.name,
      level: row.level as Level,
    }));
}

export interface AccessQuery {
  ref: RepoRef;
  isPublic: boolean;
  viewer: string | null;
}

export function accessFor(query: AccessQuery): Access {
  const { ref, isPublic, viewer } = query;

  if (viewer) {
    if (viewer === ref.owner) return "write";
    const invited = collaboratorLevel(ref, viewer);
    if (invited === "write") return "write";
    if (invited === "read") return "read";
  }

  return isPublic ? "read" : "none";
}

export function canRead(query: AccessQuery): boolean {
  return accessFor(query) !== "none";
}

export function canWrite(query: AccessQuery): boolean {
  return accessFor(query) === "write";
}
