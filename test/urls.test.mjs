/* test/urls.test.mjs
 *
 * Tests for src/urls.ts, which is a security boundary rather than a formatting
 * helper: a mirror URL that gets past this is handed to the git binary as a
 * remote to contact, and a webhook URL that gets past it is handed to fetch().
 * So the hostile cases matter more than the valid ones.
 *
 * Run:  node --experimental-strip-types test/urls.test.mjs
 */

import {
  mirrorUrl,
  discordWebhookUrl,
  maskWebhook,
  isMirrorKind,
  MIRROR_KINDS,
} from "../src/urls.ts";

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

const ok = (kind, url, expected) =>
  check(`accepts ${kind} ${url}`, mirrorUrl(kind, url) === expected);
const no = (kind, url, why) =>
  check(`refuses ${why}: ${JSON.stringify(url)}`, mirrorUrl(kind, url) === null);

console.log("\n-- kinds --");
check("github is a kind", isMirrorKind("github"));
check("codeberg is a kind", isMirrorKind("codeberg"));
check("gitlab is not", !isMirrorKind("gitlab"));
check("only two kinds exist", MIRROR_KINDS.length === 2);

console.log("\n-- valid mirror URLs --");
ok("github", "https://github.com/user/repo", "https://github.com/user/repo");
ok("codeberg", "https://codeberg.org/user/repo", "https://codeberg.org/user/repo");
ok("github", "https://github.com/user/repo.git", "https://github.com/user/repo");
ok("github", "https://github.com/user/repo/", "https://github.com/user/repo");
ok("github", "  https://github.com/user/repo  ", "https://github.com/user/repo");
ok("github", "https://GitHub.com/user/repo", "https://github.com/user/repo");
ok("codeberg", "https://codeberg.org/My-User/my.repo_1", "https://codeberg.org/My-User/my.repo_1");

console.log("\n-- wrong host --");
no("github", "https://codeberg.org/user/repo", "codeberg URL under github kind");
no("codeberg", "https://github.com/user/repo", "github URL under codeberg kind");
no("github", "https://gitlab.com/user/repo", "unrelated forge");
no("github", "https://evil.test/user/repo", "arbitrary host");
no("github", "https://github.com.evil.test/user/repo", "suffixed host");
no("github", "https://notgithub.com/user/repo", "prefixed host");
no("github", "https://evil.test/github.com/user/repo", "host in the path");
no("github", "https://github.com@evil.test/user/repo", "host as userinfo");
no("github", "https://user@github.com/user/repo", "userinfo present");
no("github", "https://user:pw@github.com/user/repo", "credentials present");
no("github", "https://github.com\\@evil.test/user/repo", "backslash authority confusion");
no("github", "https://127.0.0.1/user/repo", "loopback address");
no("github", "https://[::1]/user/repo", "ipv6 loopback");

console.log("\n-- scheme / transport --");
no("github", "http://github.com/user/repo", "plain http");
no("github", "git://github.com/user/repo", "git protocol");
no("github", "ssh://git@github.com/user/repo", "ssh");
no("github", "git@github.com:user/repo", "scp-style ssh");
no("github", "ext::sh -c whoami", "ext transport (command execution)");
no("github", "ext::echo pwned", "ext transport");
no("github", "file:///etc/passwd", "file url");
no("github", "/srv/git/other/repo.git", "absolute local path");
no("github", "../../etc/passwd", "relative local path");
no("github", "C:\\repos\\thing", "windows path");
no("github", "javascript:alert(1)", "javascript scheme");
no("github", "data:text/plain,hi", "data scheme");

console.log("\n-- argument injection --");
no("github", "--upload-pack=/bin/sh", "leading dash option");
no("github", "-c core.askPass=/bin/sh", "leading dash config");
no("github", "--output=/tmp/pwned", "leading dash output");

console.log("\n-- port / query / fragment --");
no("github", "https://github.com:8080/user/repo", "explicit port");
no("github", "https://github.com:22/user/repo", "explicit ssh port");
no("github", "https://github.com/user/repo?x=1", "query string");
// The webhook validator opts into thread_id and wait; mirrors opt into
// nothing, so those names must be just as dead here as any other.
no("github", "https://github.com/user/repo?thread_id=17", "an opted-in webhook parameter");
no("github", "https://github.com/user/repo?wait=true", "a webhook boolean");
no("github", "https://github.com/user/repo#frag", "fragment");

console.log("\n-- path shape --");
no("github", "https://github.com/user", "one path segment");
no("github", "https://github.com/", "no path");
no("github", "https://github.com/user/repo/extra", "three path segments");
no("github", "https://github.com/user/repo/../../admin", "traversal in path");
no("github", "https://github.com/../etc/passwd", "traversal as owner");
no("github", "https://github.com/./repo", "dot segment");
no("github", "https://github.com/user/..", "dotdot repo");
no("github", "https://github.com/user/.hidden", "leading-dot repo");
no("github", "https://github.com/us er/repo", "whitespace in path");
no("github", "https://github.com/user/re%2Fpo", "encoded slash");

console.log("\n-- malformed --");
no("github", "", "empty string");
no("github", "   ", "whitespace only");
no("github", "not a url", "free text");
no("github", "https://", "scheme only");
no("github", "https:///user/repo", "empty host");
no("github", "ht!tps://github.com/user/repo", "broken scheme");
ok("github", `https://github.com/user/repo\n`, "https://github.com/user/repo");
no("github", `https://github.com/user\n/repo`, "interior newline");
no("github", `https://github.com/user/re po`, "interior space");
no("github", `https://github.com/user/repo\r\nHost: evil.test`, "header injection");
no("github", `https://github.com/user/re\u0000po`, "null byte");
no("github", "https://github.com/user/" + "a".repeat(500), "over-long url");

console.log("\n-- discord webhooks --");
const W = "https://discord.com/api/webhooks/1234567890/abcDEF-_123";
check("accepts a discord webhook", discordWebhookUrl(W) === W);
check(
  "accepts a versioned path",
  discordWebhookUrl("https://discord.com/api/v10/webhooks/1/tok") ===
    "https://discord.com/api/v10/webhooks/1/tok",
);
check(
  "accepts discordapp.com",
  discordWebhookUrl("https://discordapp.com/api/webhooks/1/tok") !== null,
);
check(
  "accepts canary",
  discordWebhookUrl("https://canary.discord.com/api/webhooks/1/tok") !== null,
);
check(
  "accepts ptb",
  discordWebhookUrl("https://ptb.discord.com/api/webhooks/1/tok") !== null,
);

// thread_id and wait are the only query parameters allowed through, and only
// with these exact value shapes. Anything else must still be refused outright.
check("accepts thread_id", discordWebhookUrl(`${W}?thread_id=17`) === `${W}?thread_id=17`);
check("accepts wait=true", discordWebhookUrl(`${W}?wait=true`) === `${W}?wait=true`);
check("accepts wait=false", discordWebhookUrl(`${W}?wait=false`) === `${W}?wait=false`);
check(
  "accepts both together",
  discordWebhookUrl(`${W}?thread_id=17&wait=true`) === `${W}?thread_id=17&wait=true`,
);
check(
  "canonicalises parameter order",
  discordWebhookUrl(`${W}?wait=true&thread_id=17`) === `${W}?thread_id=17&wait=true`,
);
check(
  "keeps parameters on canary",
  discordWebhookUrl("https://canary.discord.com/api/webhooks/1/tok?thread_id=17") ===
    "https://canary.discord.com/api/webhooks/1/tok?thread_id=17",
);

const wno = (url, why) =>
  check(`refuses webhook ${why}`, discordWebhookUrl(url) === null);
wno("https://evil.test/api/webhooks/1/tok", "wrong host");
wno("https://discord.com.evil.test/api/webhooks/1/tok", "suffixed host");
wno("http://discord.com/api/webhooks/1/tok", "plain http");
wno(`${W}?username=admin`, "an unlisted parameter");
wno(`${W}?thread_id=17&evil=1`, "an unlisted parameter alongside a good one");
wno(`${W}?thread_id=abc`, "non-numeric thread_id");
wno(`${W}?thread_id=`, "empty thread_id");
wno(`${W}?thread_id=${"9".repeat(33)}`, "over-long thread_id");
wno(`${W}?thread_id=17&thread_id=18`, "a repeated parameter");
wno(`${W}?wait=1`, "wait that is not a boolean");
wno(`${W}?wait=TRUE`, "wait in the wrong case");
wno(`${W}#fragment`, "a fragment");
wno("https://discord.com/", "no webhook path");
wno("https://discord.com/api/webhooks/", "incomplete path");
wno("https://discord.com/api/webhooks/notanid/tok", "non-numeric id");
wno("https://discord.com:8443/api/webhooks/1/tok", "explicit port");
wno("https://u:p@discord.com/api/webhooks/1/tok", "credentials");
wno("https://discord.com/api/webhooks/1/tok/../../admin", "traversal");
wno("", "empty");

console.log("\n-- webhook masking (the URL is a credential) --");
const masked = maskWebhook(W);
check("mask keeps the id", masked.includes("1234567890"));
check("mask drops the token", !masked.includes("abcDEF-_123"));
check("mask of junk is inert", maskWebhook("garbage") === "(hidden)");

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
