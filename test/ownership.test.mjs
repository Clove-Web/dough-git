/* test/ownership.test.mjs
 *
 * Tests for per-user token ownership: who a token acts as. This is the rule
 * that keeps one account out of another's namespace, so it's worth pinning down
 * directly rather than only through the transport.
 *
 * Run:  node --experimental-sqlite --experimental-strip-types test/ownership.test.mjs
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "dough-own-"));
process.env.MINIGIT_REPOS_ROOT = root;
process.env.MINIGIT_DB_PATH = join(root, "test.db");

const { rememberUser } = await import("../src/users.ts");
const { createToken, revokeToken, listTokens } = await import("../src/tokens.ts");
const { authenticateGit, gitActor } = await import("../src/auth.ts");

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

function basic(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

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

const impostor = rememberUser({
  sub: "oidc-impostor",
  username: "alex.kim",
  name: "Not Alex",
  picture: null,
});

check("colliding usernames get distinct slugs", impostor.slug === "alex.kim-2");

const alexToken = createToken("laptop", alex.slug, alex.sub);
const samToken = createToken("laptop", sam.slug, sam.sub);

check(
  "no credentials is anonymous",
  authenticateGit(undefined).kind === "anonymous",
);

check(
  "a garbage token is rejected",
  authenticateGit(basic("alex.kim", "nope")).kind === "rejected",
);

const asAlex = authenticateGit(basic("alex.kim", alexToken));
check(
  "a token resolves to its owner",
  asAlex.kind === "user" && asAlex.owner === "alex.kim",
);

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
  "there is no instance-wide credential any more",
  authenticateGit(basic("anything", "static-instance-token")).kind === "rejected",
);

check("a user token acts as its owner", gitActor(asAlex) === "alex.kim");
check("anonymous acts as nobody", gitActor({ kind: "anonymous" }) === null);
check(
  "rejected credentials act as nobody",
  gitActor({ kind: "rejected", message: "no" }) === null,
);

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
