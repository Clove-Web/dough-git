// Central configuration. Everything comes from environment variables. There is
// no database: repo visibility is a filesystem marker, git auth is token(s)
// from env, and browser sessions are stateless signed cookies.

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function list(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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

  // Marker filename that makes a bare repo public. Absent = private.
  publicMarker: optional("MINIGIT_PUBLIC_MARKER", "minigit-public"),

  // Static tokens accepted as the HTTP Basic password (in addition to any
  // tokens minted via the SQLite-backed token UI). Any username works.
  gitTokens: list("MINIGIT_GIT_TOKENS"),

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

  // OIDC `sub` or email values allowed to log in. Empty = allow any successful
  // PocketID login. Set to just your own account so randoms can't get in.
  allowedUsers: list("ALLOWED_USERS"),
} as const;

export const oidcEnabled =
  Boolean(config.oidc.issuer) &&
  Boolean(config.oidc.clientId) &&
  Boolean(config.oidc.clientSecret);
