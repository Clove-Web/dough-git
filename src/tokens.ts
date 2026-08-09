// SQLite-backed git access tokens, managed from the browser.
//
// Uses Node's built-in `node:sqlite` (run with --experimental-sqlite), so there
// is no native module to compile. Only token *hashes* are stored; the plaintext
// is shown once at creation. Static tokens from MINIGIT_GIT_TOKENS keep working
// alongside these.

import { DatabaseSync } from "node:sqlite";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";

mkdirSync(dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL;");
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

export interface TokenRow {
  id: string;
  label: string;
  created_by: string | null;
  created_at: number;
  last_used: number | null;
}

export function listTokens(): TokenRow[] {
  return db
    .prepare(
      `SELECT id, label, created_by, created_at, last_used
       FROM tokens ORDER BY created_at DESC`,
    )
    .all() as unknown as TokenRow[];
}

// Returns the plaintext token exactly once; only its hash is persisted.
export function createToken(label: string, createdBy: string | null): string {
  const id = randomBytes(6).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  const plaintext = `dgt_${id}_${secret}`;
  db.prepare(
    `INSERT INTO tokens (id, label, hash, created_by, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, label.trim() || "token", sha256(plaintext), createdBy, now());
  return plaintext;
}

export function revokeToken(id: string): void {
  db.prepare("DELETE FROM tokens WHERE id = ?").run(id);
}

// True if the presented plaintext matches a stored token (and bumps last_used).
export function verifyDbToken(plaintext: string): boolean {
  const row = db
    .prepare("SELECT id FROM tokens WHERE hash = ?")
    .get(sha256(plaintext)) as { id: string } | undefined;
  if (!row) return false;
  db.prepare("UPDATE tokens SET last_used = ? WHERE id = ?").run(now(), row.id);
  return true;
}
