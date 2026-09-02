/* test/access.test.mjs
 *
 * Tests for who may read and write a repository. This is the rule that makes
 * "private" mean something on a multi-user instance, so each case is asserted
 * directly rather than inferred from the routes that call it.
 *
 * Run:  node --experimental-sqlite --experimental-strip-types test/access.test.mjs
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "dough-access-"));
process.env.MINIGIT_REPOS_ROOT = root;
process.env.MINIGIT_DB_PATH = join(root, "test.db");

const {
  accessFor,
  canRead,
  canWrite,
  setCollaborator,
  removeCollaborator,
  listCollaborators,
  collaboratorLevel,
  dropRepoAccess,
  sharedWith,
} = await import("../src/access.ts");

const { safeRef, safeObjectId } = await import("../src/git.ts");

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

const repo = { owner: "alex", name: "notes" };

function access(viewer, isPublic) {
  return accessFor({ ref: repo, isPublic, viewer });
}

check("the owner has write on their own private repo", access("alex", false) === "write");
check("a stranger sees nothing of a private repo", access("sam", false) === "none");
check("an anonymous visitor sees nothing of a private repo", access(null, false) === "none");

check("anyone may read a public repo", access(null, true) === "read");
check("a stranger may read but not write a public repo", access("sam", true) === "read");
check("the owner still has write on a public repo", access("alex", true) === "write");

setCollaborator(repo, "sam", "read");

check("a read collaborator can see a private repo", access("sam", false) === "read");
check("a read collaborator still cannot push", !canWrite({ ref: repo, isPublic: false, viewer: "sam" }));
check(
  "the grant is recorded at the level given",
  collaboratorLevel(repo, "sam") === "read",
);

setCollaborator(repo, "jo", "write");

check("a write collaborator can push", access("jo", false) === "write");
check(
  "a write collaborator on a public repo still has write",
  access("jo", true) === "write",
);

setCollaborator(repo, "sam", "write");
check("re-adding a collaborator changes their level", collaboratorLevel(repo, "sam") === "write");
check("re-adding does not duplicate the row", listCollaborators(repo).length === 2);

const otherRepo = { owner: "alex", name: "secrets" };
check(
  "a grant on one repo does not carry to another",
  access("jo", false) === "write" &&
    accessFor({ ref: otherRepo, isPublic: false, viewer: "jo" }) === "none",
);

check("inviting the owner is refused", setCollaborator(repo, "alex", "read") === false);
check(
  "the owner keeps write regardless",
  access("alex", false) === "write" && listCollaborators(repo).length === 2,
);

const jos = sharedWith("jo");
check(
  "a collaborator can find the repos shared with them",
  jos.length === 1 && jos[0].owner === "alex" && jos[0].name === "notes",
);
check("somebody with no grants has nothing shared", sharedWith("nobody").length === 0);

check("removing a collaborator reports success", removeCollaborator(repo, "sam") === true);
check("a removed collaborator loses access", access("sam", false) === "none");
check("removing a non-collaborator reports failure", removeCollaborator(repo, "sam") === false);

dropRepoAccess(repo);
check("deleting a repo drops its grants", listCollaborators(repo).length === 0);
check("and the former collaborator has no access", access("jo", false) === "none");

check("a normal repo path is accepted", safeRef("alex", "notes.git") !== null);
check("a traversal in the owner is refused", safeRef("..", "notes") === null);
check("a traversal in the name is refused", safeRef("alex", "../../etc") === null);
check("a bare dot segment is refused", safeRef(".", "notes") === null);
check("a hidden segment is refused", safeRef("alex", ".ssh") === null);
check("a slash in a segment is refused", safeRef("alex/evil", "notes") === null);

check("a real object id is accepted", safeObjectId("a94a8fe5cc") === "a94a8fe5cc");
check("an option-shaped sha is refused", safeObjectId("--output=/tmp/pwned") === null);
check("a dash-leading sha is refused", safeObjectId("-abc123") === null);
check("a non-hex sha is refused", safeObjectId("HEAD") === null);
check("an over-long sha is refused", safeObjectId("a".repeat(65)) === null);

rmSync(root, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
