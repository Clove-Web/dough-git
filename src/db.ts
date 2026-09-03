/* src/db.ts
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

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

export function hasColumn(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
    name: string;
  }[];
  return cols.some((c) => c.name === column);
}
