import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function check(fetchImplementation, url, validate, timeoutMs) {
  try {
    const response = await fetchImplementation(url, {
      headers: { accept: "application/json, text/html" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return "fail";
    }
    return (await validate(response)) ? "pass" : "fail";
  } catch {
    return "fail";
  }
}

export async function runAvailabilityProbe({
  fetch: fetchImplementation,
  healthUrl,
  rootUrl,
  timeoutMs = 5_000,
}) {
  const [root, health] = await Promise.all([
    check(
      fetchImplementation,
      rootUrl,
      async (response) => {
        const html = await response.text();
        return html.includes('<html lang="fr">') && html.includes('id="root"');
      },
      timeoutMs,
    ),
    check(
      fetchImplementation,
      healthUrl,
      async (response) => {
        const body = await response.json();
        return (
          typeof body === "object" &&
          body !== null &&
          "status" in body &&
          body.status === "ok"
        );
      },
      timeoutMs,
    ),
  ]);

  return {
    available: root === "pass" && health === "pass",
    checks: { health, root },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootUrl = process.env.Y7_PROBE_ROOT_URL;
  const healthUrl = process.env.Y7_PROBE_HEALTH_URL;

  if (!rootUrl || !healthUrl) {
    console.error("availability-probe: CONFIG_MISSING");
    process.exitCode = 1;
  } else {
    const result = await runAvailabilityProbe({
      fetch,
      healthUrl,
      rootUrl,
    });
    console.log(JSON.stringify(result));
    if (!result.available) {
      process.exitCode = 1;
    }
  }
}
