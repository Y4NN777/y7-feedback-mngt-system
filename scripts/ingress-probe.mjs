import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TEN_MEBIBYTES = 10 * 1024 * 1024;

export function buildMultipartProbe(boundary, fileBytes = TEN_MEBIBYTES) {
  if (!/^[A-Za-z0-9-]{1,70}$/u.test(boundary) || fileBytes <= 0) {
    throw new Error("INGRESS_PROBE_INPUT_INVALID");
  }
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="probe.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    "utf8",
  );
  const payload = Buffer.alloc(fileBytes, 0x61);
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([prefix, payload, suffix]);

  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
    fileBytes,
  };
}

export async function runIngressProbe({
  authorization,
  boundary,
  fetch: fetchImplementation,
  timeoutMs = 30_000,
  url,
}) {
  const probe = buildMultipartProbe(boundary);
  const safeResult = (accepted, status) => ({
    accepted,
    fileBytes: probe.fileBytes,
    status,
    totalBytes: probe.body.byteLength,
  });

  try {
    const response = await fetchImplementation(url, {
      method: "POST",
      body: probe.body,
      headers: {
        authorization,
        "content-length": String(probe.body.byteLength),
        "content-type": probe.contentType,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return safeResult(response.ok, response.status);
  } catch {
    return safeResult(false, 0);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env.Y7_INGRESS_PROBE_URL;
  const authorization = process.env.Y7_INGRESS_PROBE_AUTHORIZATION;
  if (!url || !authorization) {
    console.error("ingress-probe: CONFIG_MISSING");
    process.exitCode = 1;
  } else {
    const result = await runIngressProbe({
      authorization,
      boundary: "y7-feedback-ingress-probe",
      fetch,
      url,
    });
    console.log(JSON.stringify(result));
    if (!result.accepted) {
      process.exitCode = 1;
    }
  }
}
