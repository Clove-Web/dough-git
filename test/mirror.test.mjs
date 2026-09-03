/* test/mirror.test.mjs
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);

const root = mkdtempSync(join(tmpdir(), "dough-mirror-"));
process.env.MINIGIT_REPOS_ROOT = root;
process.env.MINIGIT_DB_PATH = join(root, "test.db");

const {
  parseLsRemote,
  compareRefs,
  rollUp,
  ancestryVerdict,
  getStatuses,
  dropMirrorStatus,
  markStale,
  needsCheck,
} = await import("../src/mirror.ts");
const { classifyRemoteError, lsRemote, createRepo, refDir, localMirrorRefs } =
  await import("../src/git.ts");

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

console.log("\n-- parsing ls-remote output --");
const SAMPLE = [
  "fe9f7fb2f2db07277ee6eef81d59b103cd1ca907\tHEAD",
  "614f1c47151e40e92b57313140e067356fafdd60\trefs/heads/main",
  "1ce22fe2085cf743e4d45bc738aec2ea5163c52f\trefs/heads/feature/thing",
  "c089584ac8dedc3aa7c2c404839bc098050298a2\trefs/tags/v2.43.0",
  "564d0252ca632e0264ed670534a51d18a689ef5d\trefs/tags/v2.43.0^{}",
  "aaaa584ac8dedc3aa7c2c404839bc098050298a2\trefs/pull/1906/head",
  "bbbb584ac8dedc3aa7c2c404839bc098050298a2\trefs/pull/1906/merge",
  "cccc584ac8dedc3aa7c2c404839bc098050298a2\trefs/notes/commits",
  "",
  "garbage line with no tab",
  "not-a-sha\trefs/heads/bogus",
].join("\n");
const parsed = parseLsRemote(SAMPLE);

check(
  "keeps branches",
  parsed.get("refs/heads/main") === "614f1c47151e40e92b57313140e067356fafdd60",
);
check("keeps branches with slashes", parsed.has("refs/heads/feature/thing"));
check(
  "keeps the tag object",
  parsed.get("refs/tags/v2.43.0") === "c089584ac8dedc3aa7c2c404839bc098050298a2",
);
check("drops the peeled ^{} entry", !parsed.has("refs/tags/v2.43.0^{}"));
check(
  "peeled sha does not overwrite the tag object",
  parsed.get("refs/tags/v2.43.0") !== "564d0252ca632e0264ed670534a51d18a689ef5d",
);
check("ignores HEAD", !parsed.has("HEAD"));
check(
  "ignores refs/pull/*",
  ![...parsed.keys()].some((k) => k.startsWith("refs/pull/")),
);
check("ignores other namespaces", !parsed.has("refs/notes/commits"));
check("ignores malformed lines", !parsed.has("refs/heads/bogus"));
check("counts only heads and tags", parsed.size === 3);
check("empty input is empty", parseLsRemote("").size === 0);
check("garbage input is empty", parseLsRemote("nonsense\n\n\t\n").size === 0);

console.log("\n-- comparing refs --");
const m = (o) => new Map(Object.entries(o));
const A = "1111111111111111111111111111111111111111";
const B = "2222222222222222222222222222222222222222";

let cmp = compareRefs(m({ "refs/heads/main": A }), m({ "refs/heads/main": A }));
check("identical: all matched", cmp.matched === 1 && cmp.total === 1);
check(
  "identical: nothing missing",
  cmp.missingLocal.length === 0 && cmp.missingRemote.length === 0,
);
check("identical rolls up to synced", rollUp(cmp, "synced") === "synced");

cmp = compareRefs(
  m({ "refs/heads/main": A, "refs/tags/v1": A }),
  m({ "refs/heads/main": A }),
);
check("a ref missing remotely is detected", cmp.missingRemote.includes("refs/tags/v1"));
check("total counts the union", cmp.total === 2 && cmp.matched === 1);
check("local-only extras roll up to ahead", rollUp(cmp, "synced") === "ahead");

cmp = compareRefs(
  m({ "refs/heads/main": A }),
  m({ "refs/heads/main": A, "refs/heads/extra": B }),
);
check("remote extras are detected", cmp.missingLocal.includes("refs/heads/extra"));
check("remote extras roll up to behind", rollUp(cmp, "synced") === "behind");

cmp = compareRefs(m({ "refs/heads/main": A }), m({ "refs/heads/main": B }));
check("a differing sha is detected", cmp.differing.includes("refs/heads/main"));
check("the head verdict wins the roll-up", rollUp(cmp, "ahead") === "ahead");
check("and again for diverged", rollUp(cmp, "diverged") === "diverged");
check("no head verdict stays honest", rollUp(cmp, null) === "out_of_sync");

cmp = compareRefs(
  m({ "refs/heads/main": A, "refs/heads/a": A }),
  m({ "refs/heads/main": A, "refs/heads/b": B }),
);
check("differences both ways -> out_of_sync", rollUp(cmp, "synced") === "out_of_sync");
check("empty on both sides -> synced", rollUp(compareRefs(m({}), m({})), null) === "synced");

console.log("\n-- ancestry, against a real repository --");
const ref = { owner: "alice", name: "anc" };
await createRepo(ref.owner, ref.name);
const work = mkdtempSync(join(tmpdir(), "dough-anc-"));
await exec("git", ["init", "-q", "--initial-branch=main", work]);
const commit = async (msg) => {
  writeFileSync(join(work, "f.txt"), msg);
  await exec("git", ["-C", work, "add", "."]);
  await exec("git", [
    "-C", work, "-c", "user.email=t@t", "-c", "user.name=T",
    "commit", "-q", "-m", msg,
  ]);
  const { stdout } = await exec("git", ["-C", work, "rev-parse", "HEAD"]);
  return stdout.trim();
};
const c1 = await commit("one");
await commit("two");
const c3 = await commit("three");
await exec("git", ["-C", work, "push", "-q", refDir(ref), "main"]);

check("equal shas -> synced", (await ancestryVerdict(ref, c3, c3)) === "synced");
check(
  "remote tip is an ancestor -> ahead (the stale-mirror alarm)",
  (await ancestryVerdict(ref, c3, c1)) === "ahead",
);
check("local tip is an ancestor -> behind", (await ancestryVerdict(ref, c1, c3)) === "behind");
check(
  "remote object we don't hold -> out_of_sync, never a guess",
  (await ancestryVerdict(ref, c3, "dead" + "beef".repeat(9))) === "out_of_sync",
);
check("null shas -> no verdict", (await ancestryVerdict(ref, null, c1)) === null);

await exec("git", ["-C", work, "checkout", "-q", "-b", "side", c1]);
const side = await commit("side");
await exec("git", ["-C", work, "push", "-q", refDir(ref), "side"]);
check("neither is an ancestor -> diverged", (await ancestryVerdict(ref, c3, side)) === "diverged");

console.log("\n-- local ref inspection --");
const local = await localMirrorRefs(ref);
check("finds local branches", local.has("refs/heads/main") && local.has("refs/heads/side"));
check("main points at the tip", local.get("refs/heads/main") === c3);
check("no HEAD entry", !local.has("HEAD"));

console.log("\n-- transport classification (measured stderr) --");
const cls = (stderr, timedOut = false) => classifyRemoteError(stderr, timedOut).kind;
check(
  "GitHub missing repository -> missing",
  cls(
    "remote: Repository not found.\nfatal: repository 'https://github.com/a/b/' not found",
  ) === "missing",
);
check(
  "Codeberg credential challenge -> denied (private OR missing; honest)",
  cls(
    "fatal: could not read Username for 'https://codeberg.org': terminal prompts disabled",
  ) === "denied",
);
check("authentication failed -> denied", cls("fatal: Authentication failed for 'https://x/'") === "denied");
check(
  "403 -> denied",
  cls("fatal: unable to access '...': The requested URL returned error: 403") === "denied",
);
check(
  "DNS failure -> error",
  cls("fatal: unable to access 'https://x/': Could not resolve host: x") === "error",
);
check(
  "TLS failure -> error",
  cls("fatal: unable to access '...': SSL certificate problem: self signed certificate") === "error",
);
check("timeout wins over any stderr -> error", cls("Repository not found.", true) === "error");
check("timeout message says so", classifyRemoteError("x", true).message === "timed out");
check("empty stderr -> error", cls("") === "error");
check(
  "the message drops git's fatal: prefix",
  !classifyRemoteError("fatal: could not resolve host", false).message.startsWith("fatal:"),
);
check(
  "the message is bounded",
  classifyRemoteError("fatal: " + "x".repeat(5000), false).message.length <= 160,
);

console.log("\n-- security: the remote helper refuses everything but https --");
const canary = join(root, "pwned.txt");
const extResult = await lsRemote(`ext::touch ${canary}`);
check("ext:: transport is refused", extResult.ok === false);
check("ext:: did NOT execute the command", !existsSync(canary));

const localUrl = `file://${refDir(ref)}`;
const controlWorks = await exec("git", ["ls-remote", localUrl]).then(
  (r) => r.stdout.includes(c3),
  () => false,
);
check("plain git CAN read this local repo (control)", controlWorks === true);
const fileResult = await lsRemote(localUrl);
check("but the hardened helper refuses file://", fileResult.ok === false);
check("and yields none of its refs", !JSON.stringify(fileResult).includes(c3));

for (const url of [
  refDir(ref),
  "git://example.invalid/a/b",
  "ssh://git@example.invalid/a/b",
  "http://example.invalid/a/b",
]) {
  const r = await lsRemote(url);
  check(`refuses ${JSON.stringify(url.slice(0, 44))}`, r.ok === false);
}

console.log("\n-- security: git config cannot rewrite the URL --");
const evilConfig = join(root, "evil.gitconfig");
writeFileSync(
  evilConfig,
  `[url "file://${refDir(ref)}"]\n\tinsteadOf = https://github.com/evil/evil\n`,
);
const rewriteReachable = await exec("git", [
  "-c", `include.path=${evilConfig}`,
  "ls-remote", "https://github.com/evil/evil",
]).then((r) => r.stdout.includes(c3), () => false);
check("the insteadOf rewrite really is reachable (control)", rewriteReachable === true);

process.env.GIT_CONFIG_GLOBAL = evilConfig;
process.env.HOME = root;
const rewritten = await lsRemote("https://github.com/evil/evil");
check(
  "the hardened helper ignores ambient git config",
  !JSON.stringify(rewritten).includes(c3),
);
delete process.env.GIT_CONFIG_GLOBAL;

console.log("\n-- security: no interactive prompt, failures are bounded --");
const started = Date.now();
const unreachable = await lsRemote("https://nonexistent.invalid/a/b");
check("an unresolvable host fails rather than hanging", unreachable.ok === false);
check("classified as a transport error", unreachable.kind === "error");
check("and returns well inside the timeout", Date.now() - started < 12000);

console.log("\n-- cache bookkeeping --");
const cref = { owner: "alice", name: "cache" };
const nowSec = Math.floor(Date.now() / 1000);
const row = (over) => ({
  kind: "github", checkedAt: nowSec, okAt: nowSec, error: null,
  state: "synced", localSha: null, remoteSha: null, detail: null, ...over,
});
check("no rows to begin with", getStatuses(cref).size === 0);
check("a missing row needs a check", needsCheck(undefined) === true);
check("a fresh row does not", needsCheck(row()) === false);
check("a row never verified does", needsCheck(row({ okAt: null, error: "x", state: null })) === true);
check("a row verified long ago does", needsCheck(row({ okAt: 1 })) === true);
check("a row invalidated by a push does", needsCheck(row({ checkedAt: 0 })) === true);
dropMirrorStatus(cref);
markStale(cref);
check("dropping and invalidating nothing is harmless", getStatuses(cref).size === 0);

rmSync(root, { recursive: true, force: true });
rmSync(work, { recursive: true, force: true });
console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
