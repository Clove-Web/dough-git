/* src/users.ts
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

import { db, now, hasColumn } from "./db.ts";
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

// Which identity provider the `sub` belongs to. NULL marks accounts created
// before this column existed, i.e. by the previous provider (PocketID).
if (!hasColumn("users", "issuer")) {
  db.exec("ALTER TABLE users ADD COLUMN issuer TEXT");
}

export interface UserRow {
  sub: string;
  slug: string;
  username: string | null;
  name: string | null;
  picture: string | null;
  issuer: string | null;
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
  /** The OIDC issuer that vouched for `sub`. */
  issuer?: string | null;
  /**
   * Let a first sign-in take over the pre-migration account whose namespace
   * matches this username. See adoptLegacyUser.
   */
  adoptLegacy?: boolean;
}

function hasTable(name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

/**
 * Moving identity providers changes every `sub`, but namespaces, tokens and
 * collaborator grants all hang off the slug. So when someone signs in from the
 * new provider for the first time, an account left over from the old one
 * (issuer IS NULL) with the same namespace is re-pointed at their new `sub`
 * rather than a fresh "name-2" namespace being made.
 *
 * Usernames on the new provider are issued by its admins, which is what makes
 * matching on them acceptable. Each old account can only be adopted once.
 */
function adoptLegacyUser(input: RememberInput): UserRow | null {
  if (!input.username || !input.issuer) return null;
  const slug = ownerSlug(input.username);
  const legacy = (db
    .prepare("SELECT * FROM users WHERE slug = ? AND issuer IS NULL")
    .get(slug) as unknown as UserRow) ?? null;
  if (!legacy) return null;

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE users SET sub = ?, issuer = ? WHERE sub = ?").run(
      input.sub,
      input.issuer,
      legacy.sub,
    );
    if (hasTable("tokens")) {
      db.prepare("UPDATE tokens SET created_by = ? WHERE created_by = ?").run(
        input.sub,
        legacy.sub,
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  console.warn(
    `[auth] adopted pre-migration account "${slug}" for ${input.issuer} subject ${input.sub}`,
  );
  return { ...legacy, sub: input.sub, issuer: input.issuer };
}

export function rememberUser(input: RememberInput): UserRow {
  const existing =
    findUserBySub(input.sub) ?? (input.adoptLegacy ? adoptLegacyUser(input) : null);
  const ts = now();
  const issuer = input.issuer ?? null;
  const profile = {
    sub: input.sub,
    username: input.username,
    name: input.name,
    picture: input.picture,
  };

  if (existing) {
    db.prepare(
      `UPDATE users SET username = ?, name = ?, picture = ?, last_login = ?,
         issuer = COALESCE(?, issuer)
       WHERE sub = ?`,
    ).run(input.username, input.name, input.picture, ts, issuer, input.sub);
    return { ...existing, ...profile, issuer: issuer ?? existing.issuer, last_login: ts };
  }

  const slug = uniqueSlug(
    ownerSlug(input.username ?? input.name ?? "user"),
    input.sub,
  );
  db.prepare(
    `INSERT INTO users (sub, slug, username, name, picture, issuer, created_at, last_login)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(input.sub, slug, input.username, input.name, input.picture, issuer, ts, ts);
  return { ...profile, slug, issuer, created_at: ts, last_login: ts };
}

export function slugForSub(sub: string | null): string | null {
  if (!sub) return null;
  return findUserBySub(sub)?.slug ?? null;
}
