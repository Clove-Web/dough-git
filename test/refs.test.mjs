/* test/refs.test.mjs
 *
 * Tests for revision resolution and the repo description, against a real bare
 * repository with real branches and tags.
 *
 * The load-bearing case is the last group: `?h=` is attacker-supplied and ends
 * up in a git argv slot, so resolveRev has to be an allow-list rather than a
 * pattern check.
 *
 * Run:  node --experimental-strip-types test/refs.test.mjs
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "dough-refs-"));
process.env.MINIGIT_REPOS_ROOT = root;
process.env.MINIGIT_DB_PATH = join(root, "test.db");

const { listRefs, resolveRev, refDir, setDescription, description, log } =
  await import("../src/git.ts");

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

const ref = { owner: "alex", name: "notes" };
const bare = refDir(ref);
mkdirSync(join(root, "alex"), { recursive: true });
await git(root, ["init", "-q", "--bare", "--initial-branch=main", bare]);

const work = join(root, "work");
await git(root, ["init", "-q", "-b", "main", work]);
writeFileSync(join(work, "README.md"), "# Notes\n");
await git(work, ["add", "."]);
await git(work, ["commit", "-qm", "first"]);
await git(work, ["tag", "v1"]);
await git(work, ["checkout", "-q", "-b", "feature/thing"]);
writeFileSync(join(work, "extra.txt"), "more\n");
await git(work, ["add", "."]);
await git(work, ["commit", "-qm", "second"]);
await git(work, ["push", "-q", bare, "main", "feature/thing", "v1"]);

const refs = await listRefs(ref);

check("HEAD's branch is reported", refs.head === "main");
check("branches are listed", refs.branches.includes("main") && refs.branches.includes("feature/thing"));
check("tags are listed", refs.tags.includes("v1"));
check("a tag is not mistaken for a branch", !refs.branches.includes("v1"));

check("no request resolves to HEAD", (await resolveRev(ref, undefined, refs)) === "main");
check("an empty request resolves to HEAD", (await resolveRev(ref, "", refs)) === "main");
check(
  "a branch with a slash resolves to itself",
  (await resolveRev(ref, "feature/thing", refs)) === "feature/thing",
);
check("a tag resolves to itself", (await resolveRev(ref, "v1", refs)) === "v1");

const head = (await log(ref, "main", 1))[0].hash;
check("a full object id resolves to itself", (await resolveRev(ref, head, refs)) === head);
check(
  "an abbreviated object id resolves to itself",
  (await resolveRev(ref, head.slice(0, 10), refs)) === head.slice(0, 10),
);

const hostile = [
  "--output=/tmp/dough-pwned",
  "--upload-pack=touch /tmp/dough-pwned",
  "-x",
  "HEAD",
  "main; touch /tmp/dough-pwned",
  "../../etc/passwd",
  "refs/heads/main",
  "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
];

for (const candidate of hostile) {
  check(
    `a hostile revision falls back to HEAD: ${JSON.stringify(candidate)}`,
    (await resolveRev(ref, candidate, refs)) === "main",
  );
}

check(
  "log on the resolved revision still works",
  (await log(ref, await resolveRev(ref, "--output=/tmp/x", refs), 5)).length > 0,
);

check("a fresh repo has no description", (await description(ref)) === "");

await setDescription(ref, "  Notes to  self  ");
check("a description is stored trimmed", (await description(ref)) === "Notes to self");

await setDescription(ref, "line one\nline two");
check("newlines are collapsed to one line", (await description(ref)) === "line one line two");

await setDescription(ref, "x".repeat(500));
check("an over-long description is capped", (await description(ref)).length === 300);

await setDescription(ref, "   ");
check("clearing restores git's placeholder", (await description(ref)) === "");
check(
  "and the file holds what other git tools expect",
  readFileSync(join(bare, "description"), "utf8").startsWith("Unnamed repository"),
);

rmSync(root, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
