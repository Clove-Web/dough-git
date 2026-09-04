/* src/config.ts
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const reposRoot = optional("MINIGIT_REPOS_ROOT", "/srv/git");

export const config = {
  reposRoot,
  baseUrl: optional("MINIGIT_BASE_URL", "http://localhost:4010"),
  host: optional("MINIGIT_HOST", "127.0.0.1"),
  port: Number(optional("MINIGIT_PORT", "4010")),
  title: optional("MINIGIT_TITLE", "dough-git"),

  staticDir: optional("MINIGIT_STATIC_DIR", "./public"),

  favicon: optional(
    "MINIGIT_FAVICON",
    "https://m.doughmination.gay/img/avatars/git.png",
  ),

  description: optional(
    "MINIGIT_DESCRIPTION",
    "A minimal self-hosted git mirror.",
  ),

  themeColor: optional("MINIGIT_THEME_COLOR", "#060d18"),

  publicMarker: optional("MINIGIT_PUBLIC_MARKER", "minigit-public"),

  dbPath: optional("MINIGIT_DB_PATH", "") || `${reposRoot}/dough-git.db`,

  autoCreate: optional("MINIGIT_AUTO_CREATE", "true") !== "false",

  trashDays: Math.max(0, Number(optional("MINIGIT_TRASH_DAYS", "30")) || 0),

  oidc: {
    issuer: optional("OIDC_ISSUER", ""),
    clientId: optional("OIDC_CLIENT_ID", ""),
    clientSecret: optional("OIDC_CLIENT_SECRET", ""),
    tokenAuth: optional("OIDC_TOKEN_AUTH", ""),
  },

  sessionSecret: optional("SESSION_SECRET", "dev-insecure-secret-change-me"),
} as const;

export const oidcEnabled =
  Boolean(config.oidc.issuer) &&
  Boolean(config.oidc.clientId) &&
  Boolean(config.oidc.clientSecret);
