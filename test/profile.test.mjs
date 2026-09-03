/* test/profile.test.mjs
 *
 * Tests for the "+" namespace and the profile README that rides on it.
 *
 * The load-bearing case is the first group. A leading "+" is what keeps the
 * route /<owner>/+repos from ever colliding with a repository, so the rule
 * "every + name is refused except the one profile repo" is a routing invariant
 * and not a cosmetic one: the moment safeRef accepts +repos, a repository can
 * shadow that page. The rest checks that a name the forge does accept survives
 * everything a normal repository survives — listing, trash, restore.
 *
 * Run:  node --experimental-strip-types test/profile.test.mjs
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "dough-profile-"));
process.env.MINIGIT_REPOS_ROOT = root;
process.env.MINIGIT_DB_PATH = join(root, "test.db");

const {
  PROFILE_REPO,
  PROFILE_REPOS_PATH,
  isProfileRepo,
  safeRef,
  refDir,
  headReadme,
  listRepos,
  createRepo,
  trashRepo,
  listTrash,
  restoreFromTrash,
  repoExists,
} = await import("../src/git.ts");

const exec = promisify(execFile);

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

async function git(cwd, args) {
  const { stdout } = await exec("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 20000,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  return stdout;
}

// -- the "+" namespace --------------------------------------------------------

console.log("-- the + namespace is reserved, with exactly one exception --");

check("the profile repo is accepted", safeRef("clove", PROFILE_REPO) !== null);
check("...and recognised", isProfileRepo(PROFILE_REPO));
check("...and only it", !isProfileRepo("dough") && !isProfileRepo("+other"));

check(
  "the repos route name is NOT a usable repository",
  safeRef("clove", PROFILE_REPOS_PATH) === null,
);
for (const name of ["+bogus", "+", "++dough", "+dough2", "+DOUGH"]) {
  check(`refuses ${name}`, safeRef("clove", name) === null);
}
check("refuses + inside a name", safeRef("clove", "a+b") === null);
check("refuses + at the end", safeRef("clove", "dough+") === null);

check(
  "the profile repo survives a .git suffix",
  safeRef("clove", `${PROFILE_REPO}.git`)?.name === PROFILE_REPO,
);
check("an owner may not use the + prefix", safeRef(PROFILE_REPO, "x") === null);

// The pre-existing guarantees have to still hold.
check("still refuses traversal", safeRef("clove", "../etc") === null);
check("still refuses a dotfile name", safeRef("clove", ".ssh") === null);
check("still accepts an ordinary name", safeRef("clove", "my-repo.v2") !== null);

// -- headReadme ---------------------------------------------------------------

console.log("\n-- the profile readme is read at HEAD --");

const created = await createRepo("clove", PROFILE_REPO);
check("the profile repo can be created", created.ok === true);

const ref = { owner: "clove", name: PROFILE_REPO };
check("an empty profile repo has no readme", (await headReadme(ref)) === null);

const work = join(root, "work");
mkdirSync(work);
await git(work, ["init", "-q", "-b", "main", "."]);
writeFileSync(join(work, "README.md"), "# hello\n\nprofile text.\n");
await git(work, ["add", "-A"]);
await git(work, ["commit", "-qm", "readme"]);
await git(work, ["push", "-q", refDir(ref), "main"]);

const found = await headReadme(ref);
check("the readme is found at HEAD", found?.path === "README.md");
check("...with its text", found?.text.includes("profile text."));

// A repo with commits but no README is the case the profile page reports
// differently from a missing repo, so it must come back as null, not throw.
const plain = await createRepo("clove", "plain");
check("a second repo is created", plain.ok === true);
await git(work, ["push", "-q", refDir({ owner: "clove", name: "plain" }), "main:main"]);
await git(work, ["rm", "-q", "README.md"]);
await git(work, ["commit", "-qm", "drop readme"]);
await git(work, ["push", "-qf", refDir({ owner: "clove", name: "plain" }), "main"]);
check(
  "a repo with commits but no readme is null",
  (await headReadme({ owner: "clove", name: "plain" })) === null,
);

// -- listing ------------------------------------------------------------------

console.log("\n-- listing ignores names the forge would refuse --");

// A directory can be created by hand; listRepos must not surface one whose
// name safeRef would reject, or the UI would link to a page that 404s.
mkdirSync(join(root, "clove", "+bogus.git"), { recursive: true });
const listed = (await listRepos()).map((r) => r.name).sort();
check("the profile repo is listed by git.ts", listed.includes(PROFILE_REPO));
check("a stray + directory is not", !listed.includes("+bogus"));
check("ordinary repos are", listed.includes("plain"));

// -- trash round-trip ---------------------------------------------------------

console.log("\n-- the profile repo trashes and restores like any other --");

const trashed = await trashRepo(ref, {
  deletedAt: Math.floor(Date.now() / 1000),
  deletedBy: "clove",
  grants: [],
});
check("it can be trashed", trashed.ok === true);
check("...and is gone", (await repoExists(ref)) === false);

const inTrash = await listTrash("clove");
check("...and appears in the trash", inTrash.some((e) => e.name === PROFILE_REPO));
check(
  "...with its name intact, not degraded",
  inTrash.find((e) => e.name === PROFILE_REPO)?.degraded === false,
);

const restored = await restoreFromTrash("clove", trashed.entry);
check("it can be restored", restored.ok === true);
check("...and is back", (await repoExists(ref)) === true);
check("...with its readme", (await headReadme(ref))?.path === "README.md");

rmSync(root, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
