/* src/settings.ts */
//
// Per-account settings.
//
// Keyed by owner slug rather than by OIDC `sub`, because the slug is the
// identity everything else in this application is keyed by (tokens.owner,
// collaborators.slug) and users.ts guarantees it never changes once assigned.
//
// This is a separate table from `users` on purpose. rememberUser() rewrites the
// user row on every login, and settings are not identity: mixing them would put
// a login on the write path for preferences, and preferences on the write path
// for a login.
//
// Kept deliberately short. A setting earns its place here by changing what the
// server does, not by filling out a page.

import { db, now } from "./db.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS user_settings (
    owner            TEXT PRIMARY KEY,
    discord_webhook  TEXT,
    discord_private  INTEGER NOT NULL DEFAULT 0,
    default_private  INTEGER NOT NULL DEFAULT 1,
    mirror_auto      INTEGER NOT NULL DEFAULT 1,
    webhook_error    TEXT,
    webhook_error_at INTEGER,
    updated_at       INTEGER NOT NULL
  );
`);

export interface Settings {
  owner: string;
  discordWebhook: string | null;
  discordPrivate: boolean;
  defaultPrivate: boolean;
  mirrorAuto: boolean;
  webhookError: string | null;
  webhookErrorAt: number | null;
}

const DEFAULTS: Omit<Settings, "owner"> = {
  discordWebhook: null,
  discordPrivate: false,
  defaultPrivate: true,
  mirrorAuto: true,
  webhookError: null,
  webhookErrorAt: null,
};

interface Row {
  owner: string;
  discord_webhook: string | null;
  discord_private: number;
  default_private: number;
  mirror_auto: number;
  webhook_error: string | null;
  webhook_error_at: number | null;
}

export function getSettings(owner: string): Settings {
  const row = db
    .prepare("SELECT * FROM user_settings WHERE owner = ?")
    .get(owner) as unknown as Row | undefined;
  if (!row) return { owner, ...DEFAULTS };
  return {
    owner,
    discordWebhook: row.discord_webhook,
    discordPrivate: row.discord_private !== 0,
    defaultPrivate: row.default_private !== 0,
    mirrorAuto: row.mirror_auto !== 0,
    webhookError: row.webhook_error,
    webhookErrorAt: row.webhook_error_at,
  };
}

function ensureRow(owner: string): void {
  db.prepare(
    `INSERT INTO user_settings (owner, updated_at) VALUES (?, ?)
     ON CONFLICT (owner) DO NOTHING`,
  ).run(owner, now());
}

export function setDiscordWebhook(owner: string, url: string | null): void {
  ensureRow(owner);
  db.prepare(
    `UPDATE user_settings
     SET discord_webhook = ?, webhook_error = NULL, webhook_error_at = NULL,
         updated_at = ?
     WHERE owner = ?`,
  ).run(url, now(), owner);
}

export interface Prefs {
  discordPrivate: boolean;
  defaultPrivate: boolean;
  mirrorAuto: boolean;
}

export function setPrefs(owner: string, prefs: Prefs): void {
  ensureRow(owner);
  db.prepare(
    `UPDATE user_settings
     SET discord_private = ?, default_private = ?, mirror_auto = ?, updated_at = ?
     WHERE owner = ?`,
  ).run(
    prefs.discordPrivate ? 1 : 0,
    prefs.defaultPrivate ? 1 : 0,
    prefs.mirrorAuto ? 1 : 0,
    now(),
    owner,
  );
}

export function recordWebhookResult(owner: string, error: string | null): void {
  ensureRow(owner);
  db.prepare(
    `UPDATE user_settings SET webhook_error = ?, webhook_error_at = ? WHERE owner = ?`,
  ).run(error ? error.slice(0, 200) : null, error ? now() : null, owner);
}

export function dropSettings(owner: string): void {
  db.prepare("DELETE FROM user_settings WHERE owner = ?").run(owner);
}
