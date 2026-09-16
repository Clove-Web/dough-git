/* test/sessions.test.mjs
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "dough-sessions-"));
process.env.MINIGIT_REPOS_ROOT = root;
process.env.MINIGIT_DB_PATH = join(root, "test.db");

const { db, now } = await import("../src/db.ts");
const { rememberUser, findUserBySlug } = await import("../src/users.ts");
const { createToken } = await import("../src/tokens.ts");
const { authenticateGit } = await import("../src/auth.ts");
const {
  createSession,
  findSession,
  revalidate,
  RECHECK_AFTER,
  OUTAGE_GRACE,
} = await import("../src/sessions.ts");

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

const SSO = "https://auth.example";
const basic = (user, pass) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

console.log("\n-- moving accounts over from the old provider --");

const legacy = rememberUser({ sub: "pocketid-clove", username: "clove", name: "Clove", picture: null });
const legacyToken = createToken("laptop", legacy.slug, legacy.sub);
check("a pre-migration account has no issuer", legacy.issuer === null);

const moved = rememberUser({
  sub: "sso-clove",
  username: "clove",
  name: "Clove T",
  picture: null,
  issuer: SSO,
  adoptLegacy: true,
});
check("first SSO sign-in keeps the old namespace", moved.slug === "clove");
check("and re-points it at the new subject", findUserBySlug("clove")?.sub === "sso-clove");
check("and records the issuer", findUserBySlug("clove")?.issuer === SSO);
check("and picks up the new profile", findUserBySlug("clove")?.name === "Clove T");
check(
  "tokens minted before the move still authenticate",
  authenticateGit(basic("clove", legacyToken)).kind === "user",
);
const createdBy = db.prepare("SELECT created_by FROM tokens WHERE owner = 'clove'").get();
check("token authorship follows the new subject", createdBy?.created_by === "sso-clove");

const again = rememberUser({ sub: "sso-clove", username: "clove", name: "Clove T", picture: null, issuer: SSO, adoptLegacy: true });
check("signing in again changes nothing", again.slug === "clove");

const squatter = rememberUser({ sub: "sso-other", username: "clove", name: "Other", picture: null, issuer: SSO, adoptLegacy: true });
check("an adopted account can't be taken over a second time", squatter.slug === "clove-2");

rememberUser({ sub: "pocketid-ari", username: "ari", name: "Ari", picture: null });
const noAdopt = rememberUser({ sub: "sso-ari", username: "ari", name: "Ari", picture: null, issuer: SSO, adoptLegacy: false });
check("with adoption off, a new namespace is made", noAdopt.slug === "ari-2");
check("and the old account is left alone", findUserBySlug("ari")?.sub === "pocketid-ari");

console.log("\n-- sessions --");

check("an unknown cookie is no session", findSession("nope") === null);
check("no cookie is no session", findSession(undefined) === null);

function makeSession(refreshToken = "rt-1") {
  const token = createSession({ sub: "sso-clove", email: "c@example.com", refreshToken, idToken: "id-1" });
  return { token, row: findSession(token) };
}

function age(row, seconds) {
  db.prepare("UPDATE sessions SET verified_at = ?, checked_at = ? WHERE id_hash = ?").run(
    now() - seconds,
    now() - seconds,
    row.id_hash,
  );
  return { ...row, verified_at: now() - seconds, checked_at: now() - seconds };
}

{
  const { token, row } = makeSession();
  check("a new session is found by its cookie", row?.sub === "sso-clove");
  check("the cookie value itself isn't stored", !JSON.stringify(row).includes(token));

  let calls = 0;
  const result = await revalidate(row, async () => {
    calls++;
    return { kind: "revoked" };
  });
  check("a freshly verified session isn't re-checked", calls === 0 && result !== null);
}

{
  const { token, row } = makeSession();
  const stale = age(row, RECHECK_AFTER + 5);
  let calls = 0;
  const refresher = async (rt) => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return { kind: "ok", sub: "sso-clove", email: "new@example.com", refreshToken: `${rt}-next`, idToken: "id-2" };
  };
  const [a, b, c] = await Promise.all([revalidate(stale, refresher), revalidate(stale, refresher), revalidate(stale, refresher)]);
  check("concurrent requests share one refresh (rotation-safe)", calls === 1);
  check("all of them stay signed in", a && b && c);
  const after = findSession(token);
  check("the rotated refresh token is stored", after?.refresh_token === "rt-1-next");
  check("the new id_token is stored", after?.id_token === "id-2");
  check("email follows the SSO", after?.email === "new@example.com");
  check("the session is marked verified", now() - after.verified_at < 5);
}

{
  const { token, row } = makeSession();
  const result = await revalidate(age(row, RECHECK_AFTER + 5), async () => ({ kind: "revoked" }));
  check("a revoked grant ends the session", result === null && findSession(token) === null);
}

{
  const { token, row } = makeSession();
  const result = await revalidate(age(row, RECHECK_AFTER + 5), async () => ({
    kind: "ok", sub: "someone-else", email: null, refreshToken: "x", idToken: "y",
  }));
  check("a refresh for a different subject ends the session", result === null && findSession(token) === null);
}

{
  const { token, row } = makeSession();
  const result = await revalidate(age(row, RECHECK_AFTER + 5), async () => ({ kind: "unavailable" }));
  check("an SSO outage within the grace period keeps the session", result !== null && findSession(token) !== null);

  let calls = 0;
  await revalidate(findSession(token), async () => {
    calls++;
    return { kind: "unavailable" };
  });
  check("and doesn't retry on every request", calls === 0);
}

{
  const { token, row } = makeSession();
  const result = await revalidate(age(row, RECHECK_AFTER + OUTAGE_GRACE + 5), async () => ({ kind: "unavailable" }));
  check("an outage past the grace period ends the session", result === null && findSession(token) === null);
}

{
  const { token, row } = makeSession();
  const result = await revalidate(age(row, RECHECK_AFTER + 5), async () => {
    throw new Error("boom");
  });
  check("a refresher that throws counts as an outage", result !== null && findSession(token) !== null);
}

{
  const { token, row } = makeSession();
  db.prepare("UPDATE sessions SET expires_at = ? WHERE id_hash = ?").run(now() - 1, row.id_hash);
  check("an expired session is gone", findSession(token) === null);
}

db.close();
rmSync(root, { recursive: true, force: true });

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall session checks passed");
