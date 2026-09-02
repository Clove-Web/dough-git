// End-to-end test of the git smart-HTTP transport.
//
// Stands up a tiny Node HTTP server backed by src/smart-http.ts, seeds a real
// bare repo, then uses the *actual git client* to clone from it and push to it,
// asserting the round trip works. This validates the trickiest part of the
// project (pkt-line framing + upload-pack/receive-pack RPC) against real git.
//
// Run:  node --experimental-strip-types test/transport.test.mjs

import { createServer } from "node:http";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pktLine,
  advertiseResponse,
  serviceRpc,
} from "../src/smart-http.ts";

const execFileAsync = promisify(execFile);

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 20000,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return stdout;
}

check(
  'pktLine("# service=git-upload-pack\\n") == "001e..."',
  pktLine("# service=git-upload-pack\n").startsWith("001e"),
);
check(
  'pktLine("# service=git-receive-pack\\n") == "001f..."',
  pktLine("# service=git-receive-pack\n").startsWith("001f"),
);

const work = mkdtempSync(join(tmpdir(), "dough-git-"));
const seed = join(work, "seed");
const bare = join(work, "repo.git");

await git(work, ["init", "-q", seed]);
writeFileSync(join(seed, "hello.txt"), "hello backup\n");
await git(seed, ["add", "."]);
await git(seed, ["commit", "-q", "-m", "initial"]);
await git(seed, ["branch", "-M", "main"]);
await git(work, ["clone", "-q", "--bare", seed, bare]);

async function sendResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  if (response.body) {
    Readable.fromWeb(response.body).pipe(res);
  } else {
    res.end();
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname.endsWith("/info/refs")) {
      const service = url.searchParams.get("service");
      await sendResponse(res, await advertiseResponse(bare, service));
      return;
    }
    if (req.method === "POST" && url.pathname.endsWith("/git-upload-pack")) {
      await sendResponse(
        res,
        serviceRpc({
          repoDir: bare,
          service: "git-upload-pack",
          body: Readable.toWeb(req),
          gzip: req.headers["content-encoding"] === "gzip",
        }),
      );
      return;
    }
    if (req.method === "POST" && url.pathname.endsWith("/git-receive-pack")) {
      await sendResponse(
        res,
        serviceRpc({
          repoDir: bare,
          service: "git-receive-pack",
          body: Readable.toWeb(req),
          gzip: req.headers["content-encoding"] === "gzip",
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  } catch (err) {
    res.statusCode = 500;
    res.end(String(err));
  }
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/repo.git`;

let cloned = false;
let pushed = false;
try {
  const out = join(work, "out");
  await git(work, ["clone", "-q", base, out]);
  const content = readFileSync(join(out, "hello.txt"), "utf8");
  cloned = content === "hello backup\n";
  check("clone over HTTP retrieves file content", cloned);

  writeFileSync(join(out, "second.txt"), "more data\n");
  await git(out, ["add", "."]);
  await git(out, ["commit", "-q", "-m", "second"]);
  await git(out, ["push", "-q", "origin", "main"]);

  const logOut = await git(bare, ["log", "--oneline"]);
  pushed = logOut.includes("second");
  check("push over HTTP updates the bare repo", pushed);
} finally {
  server.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
