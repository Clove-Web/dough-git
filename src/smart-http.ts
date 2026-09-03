/* src/smart-http.ts
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

export type GitService = "git-upload-pack" | "git-receive-pack";

const BIN: Record<GitService, string> = {
  "git-upload-pack": "upload-pack",
  "git-receive-pack": "receive-pack",
};

export function pktLine(payload: string): string {
  const length = 4 + Buffer.byteLength(payload);
  return length.toString(16).padStart(4, "0") + payload;
}

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
  body: ReadableStream<Uint8Array> | null;
  gzip: boolean;
  onDone?: (code: number) => void;
}

export function serviceRpc(opts: RpcOptions): Response {
  const child = spawn(
    "git",
    [BIN[opts.service], "--stateless-rpc", opts.repoDir],
    { stdio: ["pipe", "pipe", "inherit"] },
  );

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

  if (opts.onDone) {
    const done = opts.onDone;
    let fired = false;
    const settle = (code: number) => {
      if (fired) return;
      fired = true;
      try {
        done(code);
      } catch (err) {
        console.error("[git] rpc completion handler threw:", err);
      }
    };
    child.on("close", (code) => settle(code ?? 1));
    child.on("error", () => settle(1));
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
