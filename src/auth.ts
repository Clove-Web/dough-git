/* src/auth.ts */
//
// Authentication.
//
//  * Browser login  -> PocketID (OIDC). The resulting identity is stored in a
//    stateless, HMAC-signed session cookie; the account itself is recorded in
//    the user directory (users.ts) so its owner slug is stable.
//  * git clone/pull/push -> HTTP Basic auth. The password is a token; the
//    username is the owner slug the token belongs to.
//
// Session and OAuth-transaction state live entirely in signed cookies, so there
// is no server-side session store.

import { createHmac, timingSafeEqual } from "node:crypto";
import * as oidc from "openid-client";
import { config, oidcEnabled } from "./config.ts";
import { verifyDbToken } from "./tokens.ts";
import { rememberUser, findUserBySub } from "./users.ts";
import { ownerSlug } from "./git.ts";

// ---- signed values ----------------------------------------------------------

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", config.sessionSecret)
    .update(payload)
    .digest("base64url");
}

// Encode an object into `payload.signature`, embedding an expiry.
export function signValue(data: object, ttlSeconds: number): string {
  const body = { ...data, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const payload = b64url(JSON.stringify(body));
  return `${payload}.${sign(payload)}`;
}

// Verify and decode a signed value; returns null if tampered or expired.
export function verifyValue<T>(token: string | undefined): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.exp === "number" && data.exp < Date.now() / 1000) {
      return null;
    }
    return data as T;
  } catch {
    return null;
  }
}

// ---- sessions ---------------------------------------------------------------

export interface SessionUser {
  sub: string;
  email: string | null;
  name: string | null;
  username: string | null; // PocketID preferred_username
  slug: string; // owner namespace; assigned once, in users.ts
  picture: string | null; // PocketID avatar URL
}

// Sessions minted before slug/picture existed are still validly signed, so read
// them defensively rather than logging everyone out.
export function sessionSlug(user: SessionUser): string {
  return user.slug || ownerSlug(user.username ?? user.name ?? "user");
}

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const OAUTH_TTL = 60 * 10; // 10 minutes

export const SESSION_COOKIE = "mg_session";
export const OAUTH_COOKIE = "mg_oauth";

export function makeSessionCookie(user: SessionUser): string {
  return signValue(user, SESSION_TTL);
}

export function readSession(token: string | undefined): SessionUser | null {
  return verifyValue<SessionUser & { exp: number }>(token);
}

// Re-anchor a session cookie on the user directory.
//
// The cookie is signed and stateless, so on its own it stays good for its whole
// 30-day life: an account deleted from the directory would keep its access
// until the cookie aged out. Reading the row back on every request makes the
// removal take effect immediately, and picks up a renamed display name or a new
// avatar for free. Returns null when the session no longer names anyone.
export function currentUser(session: SessionUser): SessionUser | null {
  const row = findUserBySub(session.sub);
  if (!row) return null;

  return {
    sub: row.sub,
    email: session.email,
    name: row.name,
    username: row.username,
    slug: row.slug,
    picture: row.picture,
  };
}

// ---- git token auth ---------------------------------------------------------

// Parse an `Authorization: Basic ...` header into [user, pass].
export function parseBasicAuth(
  header: string | undefined,
): [string, string] | null {
  if (!header?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx === -1) return null;
  return [decoded.slice(0, idx), decoded.slice(idx + 1)];
}

// What a set of Basic credentials is allowed to be.
//
// There is deliberately no instance-wide credential. Every token belongs to
// exactly one account, so every push and every private read is attributable and
// bounded by that account's permissions.
export type GitAuth =
  // A token minted at /tokens, acting as exactly one owner namespace.
  | { kind: "user"; owner: string }
  // No credentials at all — the caller should send a Basic challenge.
  | { kind: "anonymous" }
  // Credentials were presented and are not usable. `message` is written back to
  // the git client, so it has to say what to fix.
  | { kind: "rejected"; message: string };

// Resolve `Authorization: Basic ...` into what it may act as.
//
// The username half is no longer decorative: for an account token it must be
// that account's owner slug. Requiring it means a push URL names who is pushing,
// which is what makes `owner/repo` paths mean anything.
export function authenticateGit(header: string | undefined): GitAuth {
  const basic = parseBasicAuth(header);
  if (!basic) return { kind: "anonymous" };

  const [username, token] = basic;
  if (!token) return { kind: "anonymous" };

  const row = verifyDbToken(token);
  if (!row) return { kind: "rejected", message: "invalid or revoked token" };

  if (!row.owner) {
    return {
      kind: "rejected",
      message:
        "this token predates per-user ownership and can't be attributed — " +
        "sign in to the web UI once to adopt it, or mint a new one at /tokens",
    };
  }

  // Accept the slug itself, and also the raw username it was derived from, so
  // `https://Alex.Kim:token@host/...` still works for owner `alex-kim`.
  const named =
    username !== "" &&
    (username === row.owner || ownerSlug(username) === row.owner);
  if (!named) {
    return {
      kind: "rejected",
      message: username
        ? `this token belongs to "${row.owner}" — use that as the username`
        : `set the username to "${row.owner}" (the token alone is not enough)`,
    };
  }

  return { kind: "user", owner: row.owner };
}

// The owner slug a set of credentials acts as, or null when they don't act as
// anybody. Repo-level authority lives in access.ts — this only says who.
export function gitActor(auth: GitAuth): string | null {
  return auth.kind === "user" ? auth.owner : null;
}

// ---- OIDC (PocketID) --------------------------------------------------------

let discovered: oidc.Configuration | null = null;

async function oidcConfig(): Promise<oidc.Configuration> {
  if (!discovered) {
    const { issuer, clientId, clientSecret, tokenAuth } = config.oidc;

    // Token-endpoint auth method. Empty = openid-client's default. Set
    // OIDC_TOKEN_AUTH=post for PocketID clients configured as client_secret_post,
    // or =none for a public (PKCE-only) client with no secret.
    let clientAuth: oidc.ClientAuth | undefined;
    switch (tokenAuth) {
      case "post":
        clientAuth = oidc.ClientSecretPost(clientSecret);
        break;
      case "basic":
        clientAuth = oidc.ClientSecretBasic(clientSecret);
        break;
      case "none":
        clientAuth = oidc.None();
        break;
      default:
        clientAuth = undefined;
    }

    discovered = await oidc.discovery(
      new URL(issuer),
      clientId,
      // When clientAuth is explicit it already carries the secret; otherwise
      // pass the secret string so openid-client uses its default method.
      clientAuth ? undefined : clientSecret,
      clientAuth,
    );
  }
  return discovered;
}

// The issuer the discovery document actually advertises. Must match the `iss`
// PocketID returns on the callback, or openid-client rejects the login.
export async function oidcIssuer(): Promise<string> {
  const cfg = await oidcConfig();
  return cfg.serverMetadata().issuer;
}

export interface AuthStart {
  redirectUrl: string;
  txCookie: string; // signed cookie carrying PKCE verifier + state
}

// Begin the OIDC login: returns the URL to send the browser to and a signed
// transaction cookie to set.
export async function startLogin(): Promise<AuthStart> {
  const cfg = await oidcConfig();
  const verifier = oidc.randomPKCECodeVerifier();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier);
  const state = oidc.randomState();

  const url = oidc.buildAuthorizationUrl(cfg, {
    redirect_uri: `${config.baseUrl}/auth/callback`,
    scope: "openid profile email",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });

  return {
    redirectUrl: url.href,
    txCookie: signValue({ verifier, state }, OAUTH_TTL),
  };
}

// Complete the OIDC login from the callback request URL. Returns the identity,
// or null if the transaction is invalid / the user isn't allowed.
export async function finishLogin(
  currentUrl: string,
  txToken: string | undefined,
): Promise<SessionUser | null> {
  const tx = verifyValue<{ verifier: string; state: string }>(txToken);
  if (!tx) return null;

  const cfg = await oidcConfig();
  const tokens = await oidc.authorizationCodeGrant(cfg, new URL(currentUrl), {
    pkceCodeVerifier: tx.verifier,
    expectedState: tx.state,
  });

  const claims = tokens.claims();
  if (!claims?.sub) {
    console.error("[auth] token response had no sub claim");
    return null;
  }

  const claimed = {
    sub: String(claims.sub),
    email: typeof claims.email === "string" ? claims.email : null,
    name: typeof claims.name === "string" ? claims.name : null,
    username:
      typeof claims.preferred_username === "string"
        ? claims.preferred_username
        : null,
    picture: typeof claims.picture === "string" ? claims.picture : null,
  };

  // Anyone PocketID vouches for is welcome: PocketID is the guest list, and
  // keeping a second one here only ever gets out of step with it. Signing in
  // earns a directory entry and with it a permanent owner slug — which is a
  // namespace of their own, not access to anybody else's.
  const row = rememberUser(claimed);
  return { ...claimed, slug: row.slug };
}

export { oidcEnabled };
