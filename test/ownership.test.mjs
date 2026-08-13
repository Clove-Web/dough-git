// Tests for per-user token ownership: who a token acts as, and what it may
// push to. This is the rule that keeps one account out of another's namespace,
// so it's worth pinning down directly rather than only through the transport.
//
// Run:  node --experimental-sqlite --experimental-strip-types test/ownership.test.mjs

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point config at a throwaway database BEFORE importing anything that opens it.
const root = mkdtempSync(join(tmpdir(), "dough-own-"));
process.env.MINIGIT_REPOS_ROOT = root;
process.env.MINIGIT_DB_PATH = join(root, "test.db");
process.env.MINIGIT_GIT_TOKENS = "static-instance-token";

const { rememberUser } = await import("../src/users.ts");
const { createToken, revokeToken, listTokens } = await import("../src/tokens.ts");
const { authenticateGit, canPushTo } = await import("../src/auth.ts");

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

function basic(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

// ---- setup ------------------------------------------------------------------

const alex = rememberUser({
  sub: "oidc-alex",
  username: "Alex.Kim",
  name: "Alex Kim",
  picture: null,
});
const sam = rememberUser({
  sub: "oidc-sam",
  username: "sam",
  name: "Sam",
  picture: null,
});

check("username is slugified into an owner segment", alex.slug === "alex.kim");

// A second account whose name collides must not land in the first one's
// namespace — that would hand it push rights over someone else's repos.
const impostor = rememberUser({
  sub: "oidc-impostor",
  username: "alex.kim",
  name: "Not Alex",
  picture: null,
});
check("colliding usernames get distinct slugs", impostor.slug === "alex.kim-2");

const alexToken = createToken("laptop", alex.slug, alex.sub);
const samToken = createToken("laptop", sam.slug, sam.sub);

// ---- identity ---------------------------------------------------------------

check(
  "no credentials is anonymous",
  authenticateGit(undefined).kind === "anonymous",
);

check(
  "a garbage token is rejected",
  authenticateGit(basic("alex.kim", "nope")).kind === "rejected",
);

const asAlex = authenticateGit(basic("alex.kim", alexToken));
check("a token resolves to its owner", asAlex.kind === "user" && asAlex.owner === "alex.kim");

const asAlexRaw = authenticateGit(basic("Alex.Kim", alexToken));
check(
  "the un-slugified username is accepted too",
  asAlexRaw.kind === "user" && asAlexRaw.owner === "alex.kim",
);

check(
  "a token with the wrong username is rejected",
  authenticateGit(basic("sam", alexToken)).kind === "rejected",
);

check(
  "a token with no username is rejected",
  authenticateGit(basic("", alexToken)).kind === "rejected",
);

check(
  "a static token is instance-wide",
  authenticateGit(basic("anything", "static-instance-token")).kind === "instance",
);

// ---- push authority ---------------------------------------------------------

check("owner may push to their own namespace", canPushTo(asAlex, "alex.kim"));
check("owner may not push to another's", !canPushTo(asAlex, "sam"));
check(
  "the colliding account may not push to the original's",
  !canPushTo(authenticateGit(basic("alex.kim-2", createToken("t", impostor.slug, impostor.sub))), "alex.kim"),
);
check(
  "a static token may push anywhere",
  canPushTo({ kind: "instance" }, "alex.kim") && canPushTo({ kind: "instance" }, "sam"),
);
check("anonymous may not push", !canPushTo({ kind: "anonymous" }, "alex.kim"));

// ---- token listing is per-owner ---------------------------------------------

check(
  "a user only sees their own tokens",
  listTokens("alex.kim").length === 1 && listTokens("sam").length === 1,
);

check(
  "revoking someone else's token is refused",
  revokeToken(listTokens("sam")[0].id, "alex.kim") === false,
);

check(
  "revoking your own token works",
  revokeToken(listTokens("sam")[0].id, "sam") === true &&
    listTokens("sam").length === 0,
);

check(
  "a revoked token stops authenticating",
  authenticateGit(basic("sam", samToken)).kind === "rejected",
);

rmSync(root, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
