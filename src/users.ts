/* src/users.ts
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

import { db, now } from "./db.ts";
import { ownerSlug } from "./git.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    sub        TEXT PRIMARY KEY,
    slug       TEXT NOT NULL UNIQUE,
    username   TEXT,
    name       TEXT,
    picture    TEXT,
    created_at INTEGER NOT NULL,
    last_login INTEGER NOT NULL
  );
`);

export interface UserRow {
  sub: string;
  slug: string;
  username: string | null;
  name: string | null;
  picture: string | null;
  created_at: number;
  last_login: number;
}

export function findUserBySlug(slug: string): UserRow | null {
  return (db
    .prepare("SELECT * FROM users WHERE slug = ?")
    .get(slug) as unknown as UserRow) ?? null;
}

export function findUserBySub(sub: string): UserRow | null {
  return (db
    .prepare("SELECT * FROM users WHERE sub = ?")
    .get(sub) as unknown as UserRow) ?? null;
}

export function listUsers(): UserRow[] {
  return db
    .prepare("SELECT * FROM users ORDER BY slug")
    .all() as unknown as UserRow[];
}

function uniqueSlug(preferred: string, sub: string): string {
  const taken = (slug: string) => {
    const row = findUserBySlug(slug);
    return row !== null && row.sub !== sub;
  };
  if (!taken(preferred)) return preferred;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${preferred}-${n}`;
    if (!taken(candidate)) return candidate;
  }
  return `${preferred}-${sub.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}`;
}

export interface RememberInput {
  sub: string;
  username: string | null;
  name: string | null;
  picture: string | null;
}

export function rememberUser(input: RememberInput): UserRow {
  const existing = findUserBySub(input.sub);
  const ts = now();

  if (existing) {
    db.prepare(
      `UPDATE users SET username = ?, name = ?, picture = ?, last_login = ?
       WHERE sub = ?`,
    ).run(input.username, input.name, input.picture, ts, input.sub);
    return { ...existing, ...input, last_login: ts };
  }

  const slug = uniqueSlug(
    ownerSlug(input.username ?? input.name ?? "user"),
    input.sub,
  );
  db.prepare(
    `INSERT INTO users (sub, slug, username, name, picture, created_at, last_login)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(input.sub, slug, input.username, input.name, input.picture, ts, ts);
  return { ...input, slug, created_at: ts, last_login: ts };
}

export function slugForSub(sub: string | null): string | null {
  if (!sub) return null;
  return findUserBySub(sub)?.slug ?? null;
}
