/* test/notify.test.mjs
 *
 * Tests for Discord notifications.
 *
 * Two things matter more than the message wording. A notification must never
 * be able to break or delay a git operation, and the webhook URL is a
 * credential that must never reach a log line. Both are asserted directly.
 *
 * fetch is stubbed throughout: these tests never touch the network.
 *
 * Run:  node --experimental-sqlite --experimental-strip-types test/notify.test.mjs
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);

const root = mkdtempSync(join(tmpdir(), "dough-notify-"));
process.env.MINIGIT_REPOS_ROOT = root;
process.env.MINIGIT_DB_PATH = join(root, "test.db");
process.env.MINIGIT_BASE_URL = "https://git.example.test";

const {
  diffRefs,
  pushEmbed,
  repoCreatedEmbed,
  repoDeletedEmbed,
  notifyRepoCreated,
  notifyRepoDeleted,
  notifyPush,
} = await import("../src/notify.ts");
const { createRepo, refDir, localMirrorRefs } = await import("../src/git.ts");
const { setDiscordWebhook, setPrefs, getSettings } = await import(
  "../src/settings.ts"
);

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

const TOKEN = "SUPERSECRETTOKENVALUE";
const WEBHOOK = `https://discord.com/api/webhooks/1234567890/${TOKEN}`;

let sent = [];
let fetchMode = "ok";
globalThis.fetch = async (url, init) => {
  sent.push({ url: String(url), body: JSON.parse(init.body) });
  if (fetchMode === "throw") throw new Error("connect ECONNREFUSED 10.0.0.1:443");
  if (fetchMode === "500") return { ok: false, status: 500 };
  return { ok: true, status: 204 };
};

let logged = [];
const realWarn = console.warn;
const realError = console.error;
console.warn = (...a) => logged.push(a.map(String).join(" "));
console.error = (...a) => logged.push(a.map(String).join(" "));

const settle = () => new Promise((r) => setTimeout(r, 60));

const ref = { owner: "alice", name: "proj" };
await createRepo(ref.owner, ref.name);
const work = mkdtempSync(join(tmpdir(), "dough-nwork-"));
await exec("git", ["init", "-q", "--initial-branch=main", work]);
const commit = async (msg) => {
  writeFileSync(join(work, "f.txt"), msg);
  await exec("git", ["-C", work, "add", "."]);
  await exec("git", [
    "-C", work, "-c", "user.email=t@t", "-c", "user.name=Test Person",
    "commit", "-q", "-m", msg,
  ]);
  const { stdout } = await exec("git", ["-C", work, "rev-parse", "HEAD"]);
  return stdout.trim();
};

console.log("\n-- describing a push --");
const c1 = await commit("first commit");
await exec("git", ["-C", work, "push", "-q", refDir(ref), "main"]);
const afterFirst = await localMirrorRefs(ref);

let changes = await diffRefs(ref, new Map(), afterFirst);
check("a new branch is one change", changes.length === 1);
check("it is refs/heads/main", changes[0].ref === "refs/heads/main");
check("with no before", changes[0].before === null);
check("and is not a force push", changes[0].forced === false);
check("and carries its commit", changes[0].commits.some((x) => x.subject === "first commit"));

const c2 = await commit("second commit");
await exec("git", ["-C", work, "push", "-q", refDir(ref), "main"]);
const afterSecond = await localMirrorRefs(ref);
changes = await diffRefs(ref, afterFirst, afterSecond);
check("a fast-forward is one change", changes.length === 1);
check("before and after are both set", changes[0].before === c1 && changes[0].after === c2);
check("not flagged as forced", changes[0].forced === false);
check("only the new commit is listed", changes[0].commits.length === 1);
check("which is the right one", changes[0].commits[0].subject === "second commit");

console.log("\n-- force push --");
await exec("git", ["-C", work, "reset", "-q", "--hard", c1]);
const c3 = await commit("rewritten");
await exec("git", ["-C", work, "push", "-q", "--force", refDir(ref), "main"]);
const afterForce = await localMirrorRefs(ref);
changes = await diffRefs(ref, afterSecond, afterForce);
check("rewriting history is detected", changes.length === 1);
check("and flagged as a force push", changes[0].forced === true);

console.log("\n-- new branch, new tag, deleted ref --");
await exec("git", ["-C", work, "checkout", "-q", "-b", "topic"]);
await commit("on a topic branch");
await exec("git", ["-C", work, "tag", "v1.0"]);
await exec("git", ["-C", work, "push", "-q", refDir(ref), "topic", "v1.0"]);
const afterMore = await localMirrorRefs(ref);
changes = await diffRefs(ref, afterForce, afterMore);
check("both new refs are reported", changes.length === 2);
check("the tag is included", changes.some((ch) => ch.ref === "refs/tags/v1.0"));
check("the branch is included", changes.some((ch) => ch.ref === "refs/heads/topic"));

const afterDelete = new Map(afterMore);
afterDelete.delete("refs/heads/topic");
changes = await diffRefs(ref, afterMore, afterDelete);
check("a deleted ref is reported", changes.length === 1);
check("with a null after", changes[0].after === null);

check("an unchanged snapshot yields nothing", (await diffRefs(ref, afterMore, afterMore)).length === 0);

console.log("\n-- embeds --");
const pushed = await diffRefs(ref, afterSecond, afterForce);
const embed = pushEmbed(ref, "alice", pushed);
check("push embed names the repo", embed.title.includes("alice/proj"));
check("push embed marks the force push", embed.description.includes("force-pushed"));
check("push embed names the pusher", embed.description.includes("alice"));
check("push embed links commits absolutely", embed.description.includes("https://git.example.test/alice/proj/commit/"));
check("no changes yields no embed", pushEmbed(ref, "alice", []) === null);
check("created embed names the repo", repoCreatedEmbed(ref, "alice").title.includes("alice/proj"));
check("deleted embed mentions recovery", repoDeletedEmbed(ref, "alice").description.includes("Recently Deleted"));

const hostile = [
  {
    ref: "refs/heads/main",
    before: c1,
    after: c2,
    forced: false,
    commits: [
      {
        hash: "a".repeat(40),
        subject: "[click me](https://evil.test) **bold** `code`",
        author: "@everyone",
        email: "",
        time: 0,
      },
    ],
  },
];
const hostileEmbed = pushEmbed(ref, "alice", hostile);
check("markdown link syntax is neutralised", !hostileEmbed.description.includes("[click me](https://evil.test)"));
check("the evil host is not linked", !/\]\(https:\/\/evil\.test\)/.test(hostileEmbed.description));
check("bold markers are escaped", !hostileEmbed.description.includes("**bold**"));

console.log("\n-- delivery: only when configured, only when allowed --");
const OWNER = "alice";
sent = [];
notifyRepoCreated(ref, OWNER, true);
await settle();
check("no webhook configured -> nothing sent", sent.length === 0);

setDiscordWebhook(OWNER, WEBHOOK);
sent = [];
notifyRepoCreated(ref, OWNER, true);
await settle();
check("public repo -> delivered", sent.length === 1);
check("delivered to the configured webhook", sent[0].url === WEBHOOK);
check("payload carries one embed", Array.isArray(sent[0].body.embeds) && sent[0].body.embeds.length === 1);

sent = [];
notifyRepoCreated(ref, OWNER, false);
await settle();
check("private repo is NOT announced by default", sent.length === 0);

setPrefs(OWNER, { discordPrivate: true, defaultPrivate: true, mirrorAuto: true });
sent = [];
notifyRepoCreated(ref, OWNER, false);
await settle();
check("private repo IS announced once opted in", sent.length === 1);

setPrefs(OWNER, { discordPrivate: false, defaultPrivate: true, mirrorAuto: true });
sent = [];
notifyRepoDeleted(ref, OWNER, true);
await settle();
check("deletion is delivered", sent.length === 1 && sent[0].body.embeds[0].title.includes("deleted"));

sent = [];
notifyPush(ref, OWNER, true, afterSecond, afterForce);
await settle();
check("push is delivered", sent.length === 1);
check("push embed mentions the force push", sent[0].body.embeds[0].description.includes("force-pushed"));

sent = [];
notifyPush(ref, OWNER, true, afterMore, afterMore);
await settle();
check("a push that changed nothing is not announced", sent.length === 0);

console.log("\n-- failure never escapes, and never leaks the URL --");
logged = [];
fetchMode = "throw";
let threw = false;
try {
  notifyRepoCreated(ref, OWNER, true);
  notifyPush(ref, OWNER, true, afterSecond, afterForce);
  await settle();
} catch {
  threw = true;
}
check("a delivery exception does not propagate", threw === false);
check("the failure was recorded on the account", getSettings(OWNER).webhookError !== null);
check("the recorded error is not the URL", !getSettings(OWNER).webhookError.includes(TOKEN));

fetchMode = "500";
notifyRepoCreated(ref, OWNER, true);
await settle();
check("an HTTP error is recorded", getSettings(OWNER).webhookError === "HTTP 500");

fetchMode = "ok";
notifyRepoCreated(ref, OWNER, true);
await settle();
check("a later success clears the error", getSettings(OWNER).webhookError === null);

const allLogs = logged.join("\n");
check("the webhook token never appears in any log", !allLogs.includes(TOKEN));
check("the full webhook URL never appears in any log", !allLogs.includes(WEBHOOK));
check("logs did mention a failure (so the check above is meaningful)", /failed/i.test(allLogs));

console.log("\n-- a broken webhook does not stop repository work --");
fetchMode = "throw";
setDiscordWebhook(OWNER, WEBHOOK);
const before = Date.now();
notifyPush(ref, OWNER, true, afterSecond, afterForce);
const elapsed = Date.now() - before;
check("notifying returns immediately (fire and forget)", elapsed < 50);
const stillWorks = await createRepo("alice", "unaffected");
check("repository operations still succeed", stillWorks.ok === true);
await settle();

console.log = console.log;
console.warn = realWarn;
console.error = realError;

rmSync(root, { recursive: true, force: true });
rmSync(work, { recursive: true, force: true });
console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
