/* test/lifecycle.test.mjs
 *
 * Tests for the repository lifecycle: soft delete into <repos>/.trash, name
 * reservation while a copy is recoverable, restore, and permanent purge.
 *
 * This is the part of the application that moves and destroys real directories,
 * so the hostile cases (traversal out of the trash root, collisions) are
 * asserted directly rather than inferred from the routes that call it.
 *
 * Run:  node --experimental-sqlite --experimental-strip-types test/lifecycle.test.mjs
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);

const root = mkdtempSync(join(tmpdir(), "dough-life-"));
process.env.MINIGIT_REPOS_ROOT = root;
process.env.MINIGIT_DB_PATH = join(root, "test.db");
process.env.MINIGIT_TRASH_DAYS = "30";

const {
  createRepo,
  initBareRepo,
  repoExists,
  refDir,
  listRepos,
  trashRepo,
  listTrash,
  trashHasName,
  restoreFromTrash,
  purgeFromTrash,
  purgeExpired,
  purgeAllExpired,
  DELETED_META,
} = await import("../src/git.ts");
const { setCollaborator, listCollaborators, collaboratorLevel } = await import(
  "../src/access.ts"
);
const { clearRepoMetadata } = await import("../src/repometa.ts");

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

const REF = { owner: "alice", name: "notes" };
const trashOf = (owner) => join(root, ".trash", owner);

async function seed(ref = REF) {
  const created = await createRepo(ref.owner, ref.name);
  if (!created.ok) throw new Error(`seed failed: ${created.error}`);
  const work = mkdtempSync(join(tmpdir(), "dough-work-"));
  await exec("git", ["init", "-q", "--initial-branch=main", work]);
  writeFileSync(join(work, "a.txt"), "hello\n");
  await exec("git", ["-C", work, "add", "."]);
  await exec("git", [
    "-C", work, "-c", "user.email=t@t", "-c", "user.name=T",
    "commit", "-q", "-m", "first",
  ]);
  await exec("git", ["-C", work, "push", "-q", refDir(ref), "main"]);
  rmSync(work, { recursive: true, force: true });
}

const trashIt = (ref, at = Math.floor(Date.now() / 1000)) =>
  trashRepo(ref, { deletedAt: at, deletedBy: ref.owner, grants: listCollaborators(ref) });

console.log("\n-- delete moves rather than destroys --");
await seed();
setCollaborator(REF, "bob", "write");
setCollaborator(REF, "carol", "read");
check("repo exists before deletion", await repoExists(REF));

const moved = await trashIt(REF);
clearRepoMetadata(REF);
check("trashRepo reports success", moved.ok === true);
check("live path is gone", !(await repoExists(REF)));
check("live directory really removed", !existsSync(refDir(REF)));
check("git data still exists in trash", existsSync(join(trashOf("alice"), moved.entry, "HEAD")));
check("entry is named <name>.<ts>.git", /^notes\.\d+\.git$/.test(moved.entry));

console.log("\n-- the deleted repo is invisible --");
const listed = await listRepos();
check("listRepos does not show it", !listed.some((r) => r.name === "notes"));
check("listRepos does not invent a '.trash' owner", !listed.some((r) => r.owner === ".trash"));

console.log("\n-- metadata snapshot --");
const meta = JSON.parse(
  readFileSync(join(trashOf("alice"), moved.entry, DELETED_META), "utf8"),
);
check("snapshot is versioned", meta.version === 1);
check("snapshot records owner", meta.owner === "alice");
check("snapshot records name", meta.name === "notes");
check("snapshot records who deleted it", meta.deletedBy === "alice");
check("snapshot records a timestamp", typeof meta.deletedAt === "number" && meta.deletedAt > 0);
check("snapshot captured both grants", meta.grants.length === 2);
check(
  "snapshot preserved levels",
  meta.grants.find((g) => g.slug === "bob")?.level === "write" &&
    meta.grants.find((g) => g.slug === "carol")?.level === "read",
);

console.log("\n-- live grants were cleared --");
check("bob has no live grant", collaboratorLevel(REF, "bob") === null);
check("carol has no live grant", collaboratorLevel(REF, "carol") === null);

console.log("\n-- the name stays reserved --");
check("trashHasName sees it", await trashHasName("alice", "notes"));
const blocked = await createRepo("alice", "notes");
check("creating the same name is refused", blocked.ok === false);
check("refusal is flagged as reserved", blocked.reserved === true);
check("refusal explains where to look", /recently deleted/i.test(blocked.error));
check("another name is still fine", (await createRepo("alice", "other")).ok === true);
check("another owner is unaffected", (await createRepo("bob", "notes")).ok === true);

console.log("\n-- listing --");
const trash = await listTrash("alice");
check("one recoverable entry", trash.length === 1);
check("entry knows its name", trash[0].name === "notes");
check("entry is not degraded", trash[0].degraded === false);
check("entry carries its grants", trash[0].grants.length === 2);
check("another owner's trash is separate", (await listTrash("bob")).length === 0);

console.log("\n-- restore --");
const restored = await restoreFromTrash("alice", moved.entry);
check("restore succeeds", restored.ok === true);
check("repo is back at its original path", await repoExists(REF));
check("git data came back", existsSync(join(refDir(REF), "HEAD")));
check("trash entry is gone", (await listTrash("alice")).length === 0);
check("metadata file was cleaned up", !existsSync(join(refDir(REF), DELETED_META)));
check("name is no longer reserved", !(await trashHasName("alice", "notes")));
const log = await exec("git", ["-C", refDir(REF), "log", "--format=%s", "-1"]);
check("restored repo still has its commit", log.stdout.trim() === "first");

console.log("\n-- restore refuses a collision --");
await seed({ owner: "alice", name: "clash" });
const clash = await trashIt({ owner: "alice", name: "clash" });
await initBareRepo({ owner: "alice", name: "clash" });
const refused = await restoreFromTrash("alice", clash.entry);
check("restore is refused", refused.ok === false);
check("refusal names the collision", /already exists/i.test(refused.error));
check("the trashed copy is still there", (await listTrash("alice")).some((e) => e.entry === clash.entry));
check("the live repo was not touched", await repoExists({ owner: "alice", name: "clash" }));

console.log("\n-- purge --");
const gone = await purgeFromTrash("alice", clash.entry);
check("purge reports success", gone === true);
check("directory is destroyed", !existsSync(join(trashOf("alice"), clash.entry)));
check("purging twice is harmless", (await purgeFromTrash("alice", clash.entry)) === false);

console.log("\n-- recreate after purge --");
const after = { owner: "alice", name: "recycled" };
await seed(after);
setCollaborator(after, "bob", "write");
const rec = await trashIt(after);
clearRepoMetadata(after);
await purgeFromTrash("alice", rec.entry);
clearRepoMetadata(after);
const remade = await createRepo(after.owner, after.name);
check("the name is free again", remade.ok === true);
check("and inherits no stale grants", listCollaborators(after).length === 0);

console.log("\n-- retention --");
const old = { owner: "alice", name: "ancient" };
await seed(old);
const oldEntry = await trashIt(old, Math.floor(Date.now() / 1000) - 40 * 86400);
const fresh = { owner: "alice", name: "recent" };
await seed(fresh);
await trashIt(fresh);
const purged = await purgeExpired("alice");
check("the expired entry was purged", purged.some((e) => e.name === "ancient"));
check("the fresh entry was kept", (await listTrash("alice")).some((e) => e.name === "recent"));
check("expired directory really gone", !existsSync(join(trashOf("alice"), oldEntry.entry)));

// purgeExpired only ever sweeps the owner being looked at, so an owner who
// never opens their own Recently Deleted page would keep expired copies for
// ever. purgeAllExpired is what makes the retention window a real one.
const bob = { owner: "bob", name: "forgotten" };
await seed(bob);
const bobEntry = await trashIt(bob, Math.floor(Date.now() / 1000) - 40 * 86400);
const bobFresh = { owner: "bob", name: "kept" };
await seed(bobFresh);
await trashIt(bobFresh);

const sweptAll = await purgeAllExpired();
check(
  "the sweep reaches an owner nobody visited",
  sweptAll.some((e) => e.owner === "bob" && e.name === "forgotten"),
);
check("...and really removes it", !existsSync(join(trashOf("bob"), bobEntry.entry)));
check(
  "...while leaving a fresh entry alone",
  (await listTrash("bob")).some((e) => e.name === "kept"),
);

console.log("\n-- degraded entry (metadata unreadable) --");
const broken = { owner: "alice", name: "broken" };
await seed(broken);
const brokenEntry = await trashIt(broken);
writeFileSync(join(trashOf("alice"), brokenEntry.entry, DELETED_META), "{ not json");
const degraded = (await listTrash("alice")).find((e) => e.entry === brokenEntry.entry);
check("entry still lists", degraded !== undefined);
check("entry is flagged degraded", degraded.degraded === true);
check("name recovered from the directory name", degraded.name === "broken");
check("degraded entry still reserves its name", await trashHasName("alice", "broken"));
check("degraded entry is restorable", (await restoreFromTrash("alice", brokenEntry.entry)).ok === true);

console.log("\n-- path safety: nothing escapes the trash root --");
const canary = join(root, "canary.txt");
writeFileSync(canary, "do not delete");
mkdirSync(join(root, "victim"), { recursive: true });
writeFileSync(join(root, "victim", "keep.txt"), "keep");

const hostile = [
  "../../etc",
  "../victim",
  "../../victim",
  "..",
  ".",
  "./notes.1.git",
  "/etc/passwd",
  "notes.1.git/../../../victim",
  "..%2fvictim",
  "\0notes.1.git",
  "notes.1.git\0",
  ".hidden.1.git",
  "notes.git",
  "notes.1",
  "notes",
  "",
  "a".repeat(300) + ".1.git",
  "no ts.git",
  "notes.1.git ",
];
for (const entry of hostile) {
  const purgedBad = await purgeFromTrash("alice", entry);
  check(`purge refuses ${JSON.stringify(entry)}`, purgedBad === false);
  const restoredBad = await restoreFromTrash("alice", entry);
  check(`restore refuses ${JSON.stringify(entry)}`, restoredBad.ok === false);
}
check("canary outside the trash survived", existsSync(canary));
check("sibling directory survived", existsSync(join(root, "victim", "keep.txt")));

for (const owner of ["../..", ".", "..", ".trash", "al/ice", "al\0ice", ""]) {
  check(
    `trash rejects owner ${JSON.stringify(owner)}`,
    (await listTrash(owner)).length === 0 &&
      (await purgeFromTrash(owner, "notes.1.git")) === false,
  );
}
check("repos root itself survived", existsSync(root));

rmSync(root, { recursive: true, force: true });
console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
