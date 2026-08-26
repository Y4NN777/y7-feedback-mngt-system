import { createServer, type IncomingHttpHeaders } from "node:http";
import { createConnection } from "node:net";

import { createClamdScanner, type ClamdExchange } from "./clamd-client.js";
import { createScanGateway } from "./gateway.js";

const maximumBytes = 10 * 1024 * 1024;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("ANTIVIRUS_SERVICE_CONFIG_INVALID");
  return value;
}

function headerRecord(headers: IncomingHttpHeaders): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value] as const] : [],
    ),
  );
}

function clamdExchange(host: string, port: number): ClamdExchange {
  return (frames) =>
    new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      const socket = createConnection({ host, port });
      socket.setTimeout(8_000);
      socket.on("connect", () => {
        for (const frame of frames) socket.write(frame);
      });
      socket.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > 2_048) {
          socket.destroy(new Error("CLAMD_RESPONSE_INVALID"));
          return;
        }
        chunks.push(Uint8Array.from(chunk));
        if (chunk.includes(0)) {
          socket.destroy();
          resolve(Uint8Array.from(Buffer.concat(chunks)));
        }
      });
      socket.on("timeout", () => socket.destroy(new Error("CLAMD_TIMEOUT")));
      socket.on("error", reject);
      socket.on("close", (hadError) => {
        if (!hadError && size === 0) reject(new Error("CLAMD_RESPONSE_INVALID"));
      });
    });
}

const key = Buffer.from(required("Y7_SCANNER_HMAC_KEY"), "base64url");
const port = Number(process.env.PORT ?? "8080");
const clamdPort = Number(process.env.CLAMAV_PORT ?? "3310");
if (
  key.byteLength !== 32 ||
  !Number.isSafeInteger(port) ||
  port < 1 ||
  port > 65_535 ||
  !Number.isSafeInteger(clamdPort) ||
  clamdPort < 1 ||
  clamdPort > 65_535
) {
  throw new Error("ANTIVIRUS_SERVICE_CONFIG_INVALID");
}
const gateway = createScanGateway(
  { keyId: required("Y7_SCANNER_KEY_ID"), hmacKey: key, maximumBytes },
  {
    nowMs: Date.now,
    scan: createClamdScanner(
      clamdExchange(process.env.CLAMAV_HOST?.trim() || "127.0.0.1", clamdPort),
    ),
  },
);

createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://scanner.invalid").pathname;
  if (request.method === "GET" && path === "/health") {
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end('{"status":"ok"}');
    return;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  let rejected = false;
  request.on("data", (chunk: Buffer) => {
    size += chunk.byteLength;
    if (size > maximumBytes) {
      rejected = true;
      request.destroy();
      response.writeHead(401, { "cache-control": "no-store" });
      response.end('{"error":"SCAN_DENIED"}');
      return;
    }
    chunks.push(Uint8Array.from(chunk));
  });
  request.on("end", () => {
    if (rejected) return;
    void gateway({
      method: request.method ?? "",
      path,
      headers: headerRecord(request.headers),
      body: Uint8Array.from(Buffer.concat(chunks)),
    }).then((result) => {
      response.writeHead(result.status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(result.body));
    });
  });
}).listen(port, "0.0.0.0");
