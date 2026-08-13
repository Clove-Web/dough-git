// SQLite-backed git access tokens, managed from the browser.
//
// Only token *hashes* are stored; the plaintext is shown once at creation.
// Every token is bound to the owner slug of whoever minted it, which is what
// lets the transport refuse a push into somebody else's namespace. Static
// tokens from MINIGIT_GIT_TOKENS keep working alongside these and are instance-
// wide (see auth.ts).

import { randomBytes, createHash } from "node:crypto";
import { db, now, hasColumn } from "./db.ts";
import { slugForSub } from "./users.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    id         TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    hash       TEXT NOT NULL,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    last_used  INTEGER
  );
`);

// Added after the first release: tokens minted before this column existed are
// backfilled from the user directory on first use (see verifyDbToken).
if (!hasColumn("tokens", "owner")) {
  db.exec("ALTER TABLE tokens ADD COLUMN owner TEXT");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface TokenRow {
  id: string;
  label: string;
  owner: string | null;
  created_by: string | null;
  created_at: number;
  last_used: number | null;
}

const COLUMNS = "id, label, owner, created_by, created_at, last_used";

// Tokens belonging to one owner slug. There is deliberately no "list them all"
// — a token label is the owner's business, not the whole instance's.
export function listTokens(owner: string): TokenRow[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM tokens WHERE owner = ? ORDER BY created_at DESC`)
    .all(owner) as unknown as TokenRow[];
}

// Returns the plaintext token exactly once; only its hash is persisted.
export function createToken(
  label: string,
  owner: string,
  createdBy: string | null,
): string {
  const id = randomBytes(6).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  const plaintext = `dgt_${id}_${secret}`;
  db.prepare(
    `INSERT INTO tokens (id, label, hash, owner, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, label.trim() || "token", sha256(plaintext), owner, createdBy, now());
  return plaintext;
}

// Revoke one of `owner`'s own tokens. Returns false if the id doesn't exist or
// belongs to somebody else.
export function revokeToken(id: string, owner: string): boolean {
  const row = db
    .prepare("SELECT owner FROM tokens WHERE id = ?")
    .get(id) as { owner: string | null } | undefined;
  if (!row || row.owner !== owner) return false;
  db.prepare("DELETE FROM tokens WHERE id = ?").run(id);
  return true;
}

// Resolve a presented plaintext to the owner slug it acts as, or null if it
// isn't a valid token. Bumps last_used as a side effect.
export function verifyDbToken(plaintext: string): { owner: string | null } | null {
  const row = db
    .prepare("SELECT id, owner, created_by FROM tokens WHERE hash = ?")
    .get(sha256(plaintext)) as
    | { id: string; owner: string | null; created_by: string | null }
    | undefined;
  if (!row) return null;

  // Pre-ownership token: adopt the slug of the account that created it, now
  // that the user directory can answer that question.
  let owner = row.owner;
  if (!owner) {
    owner = slugForSub(row.created_by);
    if (owner) {
      db.prepare("UPDATE tokens SET owner = ? WHERE id = ?").run(owner, row.id);
    }
  }

  db.prepare("UPDATE tokens SET last_used = ? WHERE id = ?").run(now(), row.id);
  return { owner };
}
