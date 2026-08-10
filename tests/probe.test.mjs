import assert from "node:assert/strict";
import test from "node:test";

import { runAvailabilityProbe } from "../scripts/probe.mjs";

function response({ body = "", json, status = 200 }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => json,
  };
}

test("BDD-OBS-004 reports bounded root and health availability", async () => {
  const fetch = async (url) =>
    url.endsWith("/health")
      ? response({ json: { status: "ok" } })
      : response({ body: '<html lang="fr"><div id="root"></div></html>' });

  assert.deepEqual(
    await runAvailabilityProbe({
      fetch,
      healthUrl: "https://api.example/health",
      rootUrl: "https://feedback.example/",
    }),
    {
      available: true,
      checks: { health: "pass", root: "pass" },
    },
  );
});

test("BDD-OBS-004 fails without disclosing response bodies", async () => {
  const privatePayload = "private-source-do-not-ship";
  const fetch = async (url) =>
    url.endsWith("/health")
      ? response({ json: { status: "wrong", detail: privatePayload } })
      : response({ body: privatePayload, status: 503 });

  const result = await runAvailabilityProbe({
    fetch,
    healthUrl: "https://api.example/health",
    rootUrl: "https://feedback.example/",
  });

  assert.deepEqual(result, {
    available: false,
    checks: { health: "fail", root: "fail" },
  });
  assert.doesNotMatch(JSON.stringify(result), /do-not-ship/u);
});
