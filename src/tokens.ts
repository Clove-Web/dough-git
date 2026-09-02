/* src/tokens.ts */
//
// SQLite-backed git access tokens, managed from the browser.
//
// Only token *hashes* are stored; the plaintext is shown once at creation.
// Every token is bound to the owner slug of whoever minted it, which is what
// lets the transport refuse a push into somebody else's namespace. There is no
// instance-wide credential: a token is always somebody in particular, and what
// that somebody may reach is decided in access.ts.

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

export function listTokens(owner: string): TokenRow[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM tokens WHERE owner = ? ORDER BY created_at DESC`)
    .all(owner) as unknown as TokenRow[];
}

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

export function revokeToken(id: string, owner: string): boolean {
  const row = db
    .prepare("SELECT owner FROM tokens WHERE id = ?")
    .get(id) as { owner: string | null } | undefined;
  if (!row || row.owner !== owner) return false;
  db.prepare("DELETE FROM tokens WHERE id = ?").run(id);
  return true;
}

export function verifyDbToken(plaintext: string): { owner: string | null } | null {
  const row = db
    .prepare("SELECT id, owner, created_by FROM tokens WHERE hash = ?")
    .get(sha256(plaintext)) as
    | { id: string; owner: string | null; created_by: string | null }
    | undefined;
  if (!row) return null;

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
