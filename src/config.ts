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

export const config = {
  reposRoot: optional("MINIGIT_REPOS_ROOT", "/srv/git"),
  baseUrl: optional("MINIGIT_BASE_URL", "http://localhost:4010"),
  host: optional("MINIGIT_HOST", "127.0.0.1"),
  port: Number(optional("MINIGIT_PORT", "4010")),
  title: optional("MINIGIT_TITLE", "minigit"),

  // Directory whose files are served at /static (drop your own style.css here).
  staticDir: optional("MINIGIT_STATIC_DIR", "./public"),

  // Marker filename that makes a bare repo public. Absent = private.
  publicMarker: optional("MINIGIT_PUBLIC_MARKER", "minigit-public"),

  // Tokens accepted as the HTTP Basic password for git clone/pull/push.
  // Any username works; only the token is checked. Generate with:
  //   openssl rand -hex 24
  gitTokens: list("MINIGIT_GIT_TOKENS"),

  oidc: {
    issuer: optional("OIDC_ISSUER", ""),
    clientId: optional("OIDC_CLIENT_ID", ""),
    clientSecret: optional("OIDC_CLIENT_SECRET", ""),
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
