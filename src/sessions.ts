/* src/sessions.ts
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

import { createHash, randomBytes } from "node:crypto";
import { db, now } from "./db.ts";

// Browser sessions live here rather than in a signed cookie so they can be
// ended from the server side: on logout, and when the SSO stops vouching for
// the account (disabled, removed from the app's allowed groups, signed out
// everywhere).
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id_hash       TEXT PRIMARY KEY,
    sub           TEXT NOT NULL,
    email         TEXT,
    refresh_token TEXT,
    id_token      TEXT,
    created_at    INTEGER NOT NULL,
    verified_at   INTEGER NOT NULL,
    checked_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL
  );
`);

db.exec("CREATE INDEX IF NOT EXISTS sessions_sub ON sessions (sub)");

/** Hard cap on a session, however often it is refreshed. */
export const SESSION_TTL = 60 * 60 * 24 * 30;
/** How stale the SSO's last word on a session may get before asking again. */
export const RECHECK_AFTER = 60 * 10;
/** How long to keep people signed in while the SSO can't be reached. */
export const OUTAGE_GRACE = 60 * 60;
/** Minimum gap between retries while the SSO is unreachable. */
const RETRY_AFTER = 60;
/** Sessions without a refresh token can't be re-checked, so they end sooner. */
export const UNCHECKED_TTL = 60 * 60 * 24;

export interface SessionRow {
  id_hash: string;
  sub: string;
  email: string | null;
  refresh_token: string | null;
  id_token: string | null;
  created_at: number;
  verified_at: number;
  checked_at: number;
  expires_at: number;
}

function hashId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface NewSession {
  sub: string;
  email: string | null;
  refreshToken: string | null;
  idToken: string | null;
}

/** Returns the cookie value. Only its hash is stored. */
export function createSession(input: NewSession): string {
  const token = randomBytes(32).toString("base64url");
  const ts = now();
  db.prepare(
    `INSERT INTO sessions (id_hash, sub, email, refresh_token, id_token, created_at, verified_at, checked_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    hashId(token),
    input.sub,
    input.email,
    input.refreshToken,
    input.idToken,
    ts,
    ts,
    ts,
    ts + (input.refreshToken ? SESSION_TTL : UNCHECKED_TTL),
  );
  return token;
}

export function findSession(token: string | undefined): SessionRow | null {
  if (!token) return null;
  const row = (db
    .prepare("SELECT * FROM sessions WHERE id_hash = ?")
    .get(hashId(token)) as unknown as SessionRow) ?? null;
  if (!row) return null;
  if (row.expires_at <= now()) {
    deleteSessionRow(row.id_hash);
    return null;
  }
  return row;
}

export function deleteSessionRow(idHash: string): void {
  db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
}

export function purgeExpiredSessions(): number {
  const result = db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
  return Number(result.changes);
}

export type RefreshOutcome =
  | {
      kind: "ok";
      sub: string | null;
      email: string | null;
      refreshToken: string | null;
      idToken: string | null;
    }
  /** The SSO refused: the session must end. */
  | { kind: "revoked" }
  /** The SSO couldn't be asked (network, outage). */
  | { kind: "unavailable" };

export type Refresher = (refreshToken: string) => Promise<RefreshOutcome>;

const inflight = new Map<string, Promise<SessionRow | null>>();

/**
 * Makes sure the SSO still vouches for a session, asking at most every
 * RECHECK_AFTER seconds. Refresh tokens rotate on every use and replaying one
 * shuts the whole grant down, so concurrent requests on one session share a
 * single refresh instead of racing each other with the same token.
 */
export function revalidate(row: SessionRow, refresh: Refresher): Promise<SessionRow | null> {
  const ts = now();
  if (ts - row.verified_at < RECHECK_AFTER) return Promise.resolve(row);

  if (!row.refresh_token) {
    // Nothing to check with; expires_at (UNCHECKED_TTL) bounds these.
    return Promise.resolve(row);
  }

  const pending = inflight.get(row.id_hash);
  if (pending) return pending;

  if (ts - row.checked_at < RETRY_AFTER) {
    // A recent attempt failed to reach the SSO; don't hammer it on every request.
    return Promise.resolve(ts - row.verified_at > RECHECK_AFTER + OUTAGE_GRACE ? end(row) : row);
  }

  const task = (async (): Promise<SessionRow | null> => {
    let outcome: RefreshOutcome;
    try {
      outcome = await refresh(row.refresh_token!);
    } catch {
      outcome = { kind: "unavailable" };
    }
    const at = now();

    if (outcome.kind === "revoked" || (outcome.kind === "ok" && outcome.sub && outcome.sub !== row.sub)) {
      return end(row);
    }

    if (outcome.kind === "unavailable") {
      if (at - row.verified_at > RECHECK_AFTER + OUTAGE_GRACE) return end(row);
      db.prepare("UPDATE sessions SET checked_at = ? WHERE id_hash = ?").run(at, row.id_hash);
      return { ...row, checked_at: at };
    }

    const updated: SessionRow = {
      ...row,
      email: outcome.email ?? row.email,
      refresh_token: outcome.refreshToken ?? row.refresh_token,
      id_token: outcome.idToken ?? row.id_token,
      verified_at: at,
      checked_at: at,
    };
    db.prepare(
      `UPDATE sessions SET email = ?, refresh_token = ?, id_token = ?, verified_at = ?, checked_at = ?
       WHERE id_hash = ?`,
    ).run(updated.email, updated.refresh_token, updated.id_token, at, at, row.id_hash);
    return updated;
  })().finally(() => inflight.delete(row.id_hash));

  inflight.set(row.id_hash, task);
  return task;
}

function end(row: SessionRow): null {
  deleteSessionRow(row.id_hash);
  return null;
}
