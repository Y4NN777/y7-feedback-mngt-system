import { createHash, createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const root = new URL("../", import.meta.url).pathname;
const compose = ["compose", "-f", "services/antivirus/compose.yaml"];
const port = "18080";
const keyId = "local-proof";
const hmacKey = randomBytes(32).toString("base64url");
const environment = {
  ...process.env,
  Y7_SCANNER_KEY_ID: keyId,
  Y7_SCANNER_HMAC_KEY: hmacKey,
  CLAMAV_HOST: "127.0.0.1",
  CLAMAV_PORT: "3310",
  PORT: port,
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: environment,
      stdio: options.quiet ? "ignore" : "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ANTIVIRUS_SMOKE_COMMAND_FAILED:${code}`)),
    );
  });
}

async function waitFor(url, attempts, delayMs) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status === 200) return;
    } catch {
      // Readiness remains unavailable until the bounded retry succeeds.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error("ANTIVIRUS_SMOKE_READINESS_FAILED");
}

async function send(bytes, nonce) {
  const timestamp = String(Date.now());
  const digest = createHash("sha256").update(bytes).digest("base64url");
  const canonical = `v1\nPOST\n/v1/scan\n${timestamp}\n${nonce}\n${digest}`;
  const signature = createHmac("sha256", Buffer.from(hmacKey, "base64url"))
    .update(canonical)
    .digest("base64url");
  const response = await fetch(`http://127.0.0.1:${port}/v1/scan`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "x-y7-key-id": keyId,
      "x-y7-timestamp": timestamp,
      "x-y7-nonce": nonce,
      "x-y7-content-sha256": digest,
      "x-y7-signature": signature,
    },
    body: bytes,
  });
  return { http: response.status, body: await response.json() };
}

async function waitForClean(bytes) {
  for (let attempt = 1; attempt <= 180; attempt += 1) {
    try {
      const result = await send(
        bytes,
        `smoke_readiness_${String(attempt).padStart(3, "0")}`,
      );
      if (result.http === 200 && result.body?.status === "clean") return result;
    } catch {
      // ClamAV updates signatures before accepting the first stream.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("ANTIVIRUS_SMOKE_CLAMAV_NOT_READY");
}

let gateway;
try {
  await run("docker", [...compose, "up", "-d", "clamav"]);
  gateway = spawn("node", ["services/antivirus/dist/main.js"], {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });
  await waitFor(`http://127.0.0.1:${port}/health`, 180, 1_000);
  const clean = await waitForClean(new TextEncoder().encode("Y7 clean probe"));
  const infectedBytes = new TextEncoder().encode(
    "X5O!P%@AP[4\\PZX54(P^)7CC)7}$" + "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  );
  const infected = await send(infectedBytes, "smoke_infected_nonce_01");
  if (
    clean.http !== 200 ||
    clean.body?.status !== "clean" ||
    infected.http !== 200 ||
    infected.body?.status !== "infected"
  ) {
    throw new Error("ANTIVIRUS_SMOKE_VERDICT_INVALID");
  }
  process.stdout.write(
    `${JSON.stringify({ clean: clean.body.status, infected: infected.body.status })}\n`,
  );
} finally {
  gateway?.kill("SIGTERM");
  await run("docker", [...compose, "down"], { quiet: true }).catch(() => undefined);
}
