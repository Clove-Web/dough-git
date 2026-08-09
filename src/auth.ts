// Authentication, with no database.
//
//  * Browser login  -> PocketID (OIDC). The resulting identity is stored in a
//    stateless, HMAC-signed session cookie.
//  * git clone/pull/push -> HTTP Basic auth whose password is one of the tokens
//    in MINIGIT_GIT_TOKENS.
//
// Session and OAuth-transaction state live entirely in signed cookies, so there
// is nothing to persist.

import { createHmac, timingSafeEqual } from "node:crypto";
import * as oidc from "openid-client";
import { config, oidcEnabled } from "./config.ts";

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

// A user is allowed in if ALLOWED_USERS is empty, or their sub/email is listed.
export function isAllowed(user: SessionUser): boolean {
  if (config.allowedUsers.length === 0) return true;
  return (
    config.allowedUsers.includes(user.sub) ||
    (user.email != null && config.allowedUsers.includes(user.email))
  );
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

// Constant-time check of a presented token against the configured set.
export function isValidGitToken(token: string): boolean {
  const candidate = Buffer.from(token);
  let ok = false;
  for (const known of config.gitTokens) {
    const target = Buffer.from(known);
    if (candidate.length === target.length && timingSafeEqual(candidate, target)) {
      ok = true;
    }
  }
  return ok;
}

// ---- OIDC (PocketID) --------------------------------------------------------

let discovered: oidc.Configuration | null = null;

async function oidcConfig(): Promise<oidc.Configuration> {
  if (!discovered) {
    discovered = await oidc.discovery(
      new URL(config.oidc.issuer),
      config.oidc.clientId,
      config.oidc.clientSecret,
    );
  }
  return discovered;
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
  if (!claims?.sub) return null;

  const user: SessionUser = {
    sub: String(claims.sub),
    email: typeof claims.email === "string" ? claims.email : null,
    name: typeof claims.name === "string" ? claims.name : null,
  };
  return isAllowed(user) ? user : null;
}

export { oidcEnabled };
