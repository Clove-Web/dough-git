/* src/auth.ts
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import * as oidc from "openid-client";
import { config, oidcEnabled } from "./config.ts";
import { verifyDbToken } from "./tokens.ts";
import { rememberUser, findUserBySub } from "./users.ts";
import {
  createSession,
  deleteSessionRow,
  findSession,
  revalidate,
  type RefreshOutcome,
} from "./sessions.ts";
import { ownerSlug } from "./git.ts";

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", config.sessionSecret)
    .update(payload)
    .digest("base64url");
}

export function signValue(data: object, ttlSeconds: number): string {
  const body = { ...data, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const payload = b64url(JSON.stringify(body));
  return `${payload}.${sign(payload)}`;
}

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

export interface SessionUser {
  sub: string;
  email: string | null;
  name: string | null;
  username: string | null;
  slug: string;
  picture: string | null;
}

export function sessionSlug(user: SessionUser): string {
  return user.slug || ownerSlug(user.username ?? user.name ?? "user");
}

const OAUTH_TTL = 60 * 10;

export const SESSION_COOKIE = "mg_session";
export const OAUTH_COOKIE = "mg_oauth";

export function parseBasicAuth(
  header: string | undefined,
): [string, string] | null {
  if (!header?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx === -1) return null;
  return [decoded.slice(0, idx), decoded.slice(idx + 1)];
}

export type GitAuth =
  | { kind: "user"; owner: string }
  | { kind: "anonymous" }
  | { kind: "rejected"; message: string };

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

export function gitActor(auth: GitAuth): string | null {
  return auth.kind === "user" ? auth.owner : null;
}

// --- OIDC (Doughmination SSO) ---------------------------------------------------

let discovered: Promise<oidc.Configuration> | null = null;

function oidcConfig(): Promise<oidc.Configuration> {
  if (!discovered) {
    const { issuer, clientId, clientSecret } = config.oidc;
    const insecure = issuer.startsWith("http://");
    discovered = oidc
      .discovery(new URL(issuer), clientId, clientSecret, undefined, {
        // Plain http is only ever a local auth-server during development.
        execute: insecure ? [oidc.allowInsecureRequests] : [],
      })
      .catch((err) => {
        // Don't cache a failed discovery; try again on the next request.
        discovered = null;
        throw err;
      });
  }
  return discovered;
}

export async function oidcIssuer(): Promise<string> {
  const cfg = await oidcConfig();
  return cfg.serverMetadata().issuer;
}

export function accountUrl(): string | null {
  return config.oidc.issuer ? `${config.oidc.issuer}/account` : null;
}

export interface AuthStart {
  redirectUrl: string;
  txCookie: string;
}

export async function startLogin(): Promise<AuthStart> {
  const cfg = await oidcConfig();
  const verifier = oidc.randomPKCECodeVerifier();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();

  const url = oidc.buildAuthorizationUrl(cfg, {
    redirect_uri: `${config.baseUrl}/auth/callback`,
    // offline_access gets a refresh token, which is how a session keeps
    // checking that the SSO still vouches for the account.
    scope: "openid profile email offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });

  return {
    redirectUrl: url.href,
    txCookie: signValue({ verifier, state, nonce }, OAUTH_TTL),
  };
}

type Claims = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function rememberFromClaims(claims: Claims) {
  return rememberUser({
    sub: String(claims.sub),
    username: str(claims.preferred_username),
    name: str(claims.name),
    picture: str(claims.picture),
    issuer: config.oidc.issuer,
    adoptLegacy: config.oidc.adoptLegacyUsers,
  });
}

/** Completes the code flow. Returns the new session cookie value, or null. */
export async function finishLogin(
  currentUrl: string,
  txToken: string | undefined,
): Promise<string | null> {
  const tx = verifyValue<{ verifier: string; state: string; nonce: string }>(txToken);
  if (!tx) return null;

  const cfg = await oidcConfig();
  const tokens = await oidc.authorizationCodeGrant(cfg, new URL(currentUrl), {
    pkceCodeVerifier: tx.verifier,
    expectedState: tx.state,
    expectedNonce: tx.nonce,
  });

  const claims = tokens.claims();
  if (!claims?.sub) {
    console.error("[auth] token response had no sub claim");
    return null;
  }

  rememberFromClaims(claims);
  return createSession({
    sub: String(claims.sub),
    email: str(claims.email),
    refreshToken: tokens.refresh_token ?? null,
    idToken: tokens.id_token ?? null,
  });
}

async function refreshWithSso(refreshToken: string): Promise<RefreshOutcome> {
  try {
    const cfg = await oidcConfig();
    const tokens = await oidc.refreshTokenGrant(cfg, refreshToken);
    const claims = tokens.claims();
    // Names, avatars and usernames edited in the SSO show up here without a
    // fresh sign-in. The namespace (slug) never changes.
    if (claims?.sub) rememberFromClaims(claims);
    return {
      kind: "ok",
      sub: claims?.sub ? String(claims.sub) : null,
      email: claims ? str(claims.email) : null,
      refreshToken: tokens.refresh_token ?? null,
      idToken: tokens.id_token ?? null,
    };
  } catch (err) {
    if (err instanceof oidc.ResponseBodyError && err.error === "invalid_grant") {
      return { kind: "revoked" };
    }
    console.warn("[auth] could not reach the SSO to re-check a session:", err instanceof Error ? err.message : err);
    return { kind: "unavailable" };
  }
}

/** Resolves the session cookie to a user, re-checking with the SSO when due. */
export async function sessionUser(token: string | undefined): Promise<SessionUser | null> {
  const found = findSession(token);
  if (!found) return null;

  const session = await revalidate(found, refreshWithSso);
  if (!session) return null;

  const row = findUserBySub(session.sub);
  if (!row) {
    deleteSessionRow(session.id_hash);
    return null;
  }

  return {
    sub: row.sub,
    email: session.email,
    name: row.name,
    username: row.username,
    slug: row.slug,
    picture: row.picture,
  };
}

/**
 * Ends the session here, revokes its refresh token, and returns where to send
 * the browser: the SSO's logout (so the SSO session ends too), or home.
 */
export async function logout(token: string | undefined): Promise<string> {
  const session = findSession(token);
  const home = `${config.baseUrl}/`;
  if (!session) return home;
  deleteSessionRow(session.id_hash);

  if (!oidcEnabled) return home;
  try {
    const cfg = await oidcConfig();
    if (session.refresh_token) {
      await oidc.tokenRevocation(cfg, session.refresh_token).catch((err) => {
        console.warn("[auth] refresh token revocation failed:", err instanceof Error ? err.message : err);
      });
    }
    if (!cfg.serverMetadata().end_session_endpoint) return home;
    const params: Record<string, string> = {
      post_logout_redirect_uri: home,
      client_id: config.oidc.clientId,
    };
    // With the id_token as proof, the SSO signs out without asking again.
    if (session.id_token) params.id_token_hint = session.id_token;
    return oidc.buildEndSessionUrl(cfg, params).href;
  } catch (err) {
    console.warn("[auth] SSO logout unavailable:", err instanceof Error ? err.message : err);
    return home;
  }
}

export { oidcEnabled };
