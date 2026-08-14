/* src/config.ts */
//
// Central configuration. Everything comes from environment variables. Repo
// visibility is a filesystem marker plus a collaborator table, git auth is
// per-user tokens minted in the browser, and browser sessions are stateless
// signed cookies over a SQLite user directory.

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

  // Directory whose files are served at /static (drop your own style.css here).
  staticDir: optional("MINIGIT_STATIC_DIR", "./public"),

  // Site icon. Used as the favicon and as the social-preview image, so it wants
  // to be an absolute URL that works off-site.
  favicon: optional(
    "MINIGIT_FAVICON",
    "https://m.doughmination.gay/img/avatars/git.png",
  ),

  // Fallback <meta name="description"> for pages that don't derive their own.
  description: optional(
    "MINIGIT_DESCRIPTION",
    "A minimal self-hosted git mirror.",
  ),

  // Browser UI colour on mobile. Matches the theme background in
  // src/styles/theme.css.ts.
  themeColor: optional("MINIGIT_THEME_COLOR", "#0a0b10"),

  // Marker filename that makes a bare repo public. Absent = private.
  publicMarker: optional("MINIGIT_PUBLIC_MARKER", "minigit-public"),

  // SQLite file backing the token UI. Defaults inside the repos volume so it
  // persists. Note: a non-.git file here is ignored by the repo listing.
  dbPath: optional("MINIGIT_DB_PATH", "") || `${reposRoot}/dough-git.db`,

  // Auto-create a bare repo on first authenticated push (great for a backup
  // target — just `git push` and the repo appears). Set to "false" to disable.
  autoCreate: optional("MINIGIT_AUTO_CREATE", "true") !== "false",

  oidc: {
    issuer: optional("OIDC_ISSUER", ""),
    clientId: optional("OIDC_CLIENT_ID", ""),
    clientSecret: optional("OIDC_CLIENT_SECRET", ""),
    // "" (default) | "basic" | "post" | "none" — token-endpoint auth method.
    tokenAuth: optional("OIDC_TOKEN_AUTH", ""),
  },

  // Signs session + OAuth transaction cookies. `openssl rand -hex 32`.
  sessionSecret: optional("SESSION_SECRET", "dev-insecure-secret-change-me"),
} as const;

export const oidcEnabled =
  Boolean(config.oidc.issuer) &&
  Boolean(config.oidc.clientId) &&
  Boolean(config.oidc.clientSecret);
