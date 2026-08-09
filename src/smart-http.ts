// Git "smart HTTP" transport.
//
// This implements the two request shapes a git client makes when cloning,
// fetching, or pushing over HTTP:
//
//   GET  /<repo>/info/refs?service=git-upload-pack     -> ref advertisement
//   POST /<repo>/git-upload-pack                       -> fetch / clone
//   POST /<repo>/git-receive-pack                      -> push
//
// We shell out to the real `git upload-pack` / `git receive-pack` binaries in
// `--stateless-rpc` mode, which is exactly what git's own http-backend does.
// Auth/authorization is handled by the caller (server.ts) before we get here.

import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

export type GitService = "git-upload-pack" | "git-receive-pack";

const BIN: Record<GitService, string> = {
  "git-upload-pack": "upload-pack",
  "git-receive-pack": "receive-pack",
};

// Encode a single pkt-line: a 4-char hex length prefix (counting itself)
// followed by the payload. `0000` is the special "flush" packet.
export function pktLine(payload: string): string {
  const length = 4 + Buffer.byteLength(payload);
  return length.toString(16).padStart(4, "0") + payload;
}

// Build the ref-advertisement body for a GET /info/refs request.
// Format:  pkt("# service=<svc>\n") + flush + <git advertise-refs output>
export async function advertiseRefs(
  repoDir: string,
  service: GitService,
): Promise<Buffer> {
  const child = spawn(
    "git",
    [BIN[service], "--stateless-rpc", "--advertise-refs", repoDir],
    { stdio: ["ignore", "pipe", "inherit"] },
  );

  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (code !== 0) {
    throw new Error(`git ${BIN[service]} --advertise-refs exited ${code}`);
  }

  const header = Buffer.from(pktLine(`# service=${service}\n`) + "0000");
  return Buffer.concat([header, ...chunks]);
}

export interface RpcOptions {
  repoDir: string;
  service: GitService;
  // Raw request body as a web ReadableStream (c.req.raw.body).
  body: ReadableStream<Uint8Array> | null;
  // True when the client sent `Content-Encoding: gzip`.
  gzip: boolean;
}

// Run an upload-pack / receive-pack RPC and return a streaming Response whose
// body is the git process's stdout.
export function serviceRpc(opts: RpcOptions): Response {
  const child = spawn(
    "git",
    [BIN[opts.service], "--stateless-rpc", opts.repoDir],
    { stdio: ["pipe", "pipe", "inherit"] },
  );

  // Pipe the (optionally gzip'd) request body into git's stdin.
  if (opts.body) {
    let input: NodeJS.ReadableStream = Readable.fromWeb(
      opts.body as import("node:stream/web").ReadableStream,
    );
    if (opts.gzip) {
      input = input.pipe(createGunzip());
    }
    input.pipe(child.stdin);
  } else {
    child.stdin.end();
  }

  const webStdout = Readable.toWeb(
    child.stdout,
  ) as unknown as ReadableStream<Uint8Array>;

  return new Response(webStdout, {
    status: 200,
    headers: {
      "Content-Type": `application/x-${opts.service}-result`,
      "Cache-Control": "no-cache",
    },
  });
}

// Build the Response for a GET /info/refs advertisement.
export async function advertiseResponse(
  repoDir: string,
  service: GitService,
): Promise<Response> {
  const body = await advertiseRefs(repoDir, service);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": `application/x-${service}-advertisement`,
      "Cache-Control": "no-cache",
    },
  });
}
