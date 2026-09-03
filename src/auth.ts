/* src/auth.ts
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import * as oidc from "openid-client";
import { config, oidcEnabled } from "./config.ts";
import { verifyDbToken } from "./tokens.ts";
import { rememberUser, findUserBySub } from "./users.ts";
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

const SESSION_TTL = 60 * 60 * 24 * 30;
const OAUTH_TTL = 60 * 10;

export const SESSION_COOKIE = "mg_session";
export const OAUTH_COOKIE = "mg_oauth";

export function makeSessionCookie(user: SessionUser): string {
  return signValue(user, SESSION_TTL);
}

export function readSession(token: string | undefined): SessionUser | null {
  return verifyValue<SessionUser & { exp: number }>(token);
}

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

let discovered: oidc.Configuration | null = null;

async function oidcConfig(): Promise<oidc.Configuration> {
  if (!discovered) {
    const { issuer, clientId, clientSecret, tokenAuth } = config.oidc;

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
      clientAuth ? undefined : clientSecret,
      clientAuth,
    );
  }
  return discovered;
}

export async function oidcIssuer(): Promise<string> {
  const cfg = await oidcConfig();
  return cfg.serverMetadata().issuer;
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

  const row = rememberUser(claimed);
  return { ...claimed, slug: row.slug };
}

export { oidcEnabled };
