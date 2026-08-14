/* src/db.ts */
//
// The one SQLite handle, shared by the users, tokens and collaborators tables.
//
// Uses Node's built-in `node:sqlite` (run with --experimental-sqlite), so there
// is no native module to compile. Both tables are small and only ever touched
// on login, token management, and git auth, so synchronous access is fine.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL;");

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

// True if `table` already has `column` — used to apply additive migrations to
// databases created by an older version.
export function hasColumn(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
    name: string;
  }[];
  return cols.some((c) => c.name === column);
}
