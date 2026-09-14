import { createHash, createHmac, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

const probeBytes = new TextEncoder().encode("Y7 Preview authority probe");

function fail(code, detail) {
  const error = new Error(code);
  error.code = code;
  if (detail !== undefined) error.cause = detail;
  return error;
}

function parseAuthority(value) {
  let url;
  try {
    url = new URL(value.endpoint);
  } catch (error) {
    throw fail("G5_PREVIEW_SCANNER_AUTHORITY_INVALID", error);
  }
  const key = Buffer.from(value.hmacKey, "base64url");
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    !/^[A-Za-z0-9_.-]{1,64}$/u.test(value.keyId) ||
    key.byteLength !== 32 ||
    !Number.isInteger(value.timeoutMs) ||
    value.timeoutMs < 1 ||
    value.timeoutMs > 10_000
  ) {
    throw fail("G5_PREVIEW_SCANNER_AUTHORITY_INVALID");
  }
  return { url, key };
}

async function request(fetchImplementation, input, init, timeoutMs) {
  try {
    return await fetchImplementation(input, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw fail("G5_PREVIEW_SCANNER_UNAVAILABLE", error);
  }
}

export async function probeAntivirusAuthority(authority, dependencies = {}) {
  const { url, key } = parseAuthority(authority);
  const fetchImplementation = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const nonce = dependencies.nonce ?? (() => randomBytes(18).toString("base64url"));

  const healthUrl = new URL("/health", url);
  const health = await request(
    fetchImplementation,
    healthUrl,
    { headers: { accept: "application/json" } },
    authority.timeoutMs,
  );
  if (!health.ok) throw fail("G5_PREVIEW_SCANNER_UNAVAILABLE");
  let healthBody;
  try {
    healthBody = await health.json();
  } catch (error) {
    throw fail("G5_PREVIEW_SCANNER_UNAVAILABLE", error);
  }
  if (healthBody?.status !== "ok") throw fail("G5_PREVIEW_SCANNER_UNAVAILABLE");

  const timestamp = String(now());
  const requestNonce = nonce();
  const digest = createHash("sha256").update(probeBytes).digest("base64url");
  const canonical = `v1\nPOST\n/v1/scan\n${timestamp}\n${requestNonce}\n${digest}`;
  const signature = createHmac("sha256", key).update(canonical).digest("base64url");
  const scan = await request(
    fetchImplementation,
    new URL("/v1/scan", url),
    {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(probeBytes.byteLength),
        "x-y7-key-id": authority.keyId,
        "x-y7-timestamp": timestamp,
        "x-y7-nonce": requestNonce,
        "x-y7-content-sha256": digest,
        "x-y7-signature": signature,
      },
      body: probeBytes,
    },
    authority.timeoutMs,
  );
  if (scan.status === 401 || scan.status === 403)
    throw fail("G5_PREVIEW_SCANNER_AUTHORITY_REJECTED");
  if (!scan.ok) throw fail("G5_PREVIEW_SCANNER_UNAVAILABLE");
  let scanBody;
  try {
    scanBody = await scan.json();
  } catch (error) {
    throw fail("G5_PREVIEW_SCANNER_UNAVAILABLE", error);
  }
  if (scanBody?.status !== "clean") throw fail("G5_PREVIEW_SCANNER_VERDICT_INVALID");

  return {
    status: "ready",
    release: typeof healthBody.release === "string" ? healthBody.release : undefined,
  };
}

async function main() {
  try {
    const result = await probeAntivirusAuthority({
      endpoint: process.env.ANTIVIRUS_SCANNER_ENDPOINT ?? "",
      keyId: process.env.ANTIVIRUS_SCANNER_KEY_ID ?? "",
      hmacKey: process.env.ANTIVIRUS_SCANNER_HMAC_KEY ?? "",
      timeoutMs: Number(process.env.ANTIVIRUS_SCANNER_TIMEOUT_MS),
    });
    process.stdout.write(
      `${JSON.stringify({ result: "G5_PREVIEW_SCANNER_READY", ...result })}\n`,
    );
  } catch (error) {
    const code =
      typeof error?.code === "string"
        ? error.code
        : "G5_PREVIEW_SCANNER_PREFLIGHT_FAILED";
    process.stderr.write(`${JSON.stringify({ error: code })}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
