import assert from "node:assert/strict";
import test from "node:test";

import {
  TEN_MEBIBYTES,
  buildMultipartProbe,
  runIngressProbe,
} from "../scripts/ingress-probe.mjs";

test("BDD-ATT-001 builds exactly 10 MiB plus deterministic multipart overhead", () => {
  const first = buildMultipartProbe("y7-boundary");
  const second = buildMultipartProbe("y7-boundary");

  assert.equal(first.fileBytes, TEN_MEBIBYTES);
  assert.ok(first.body.byteLength > TEN_MEBIBYTES);
  assert.equal(first.body.byteLength, second.body.byteLength);
  assert.equal(first.contentType, "multipart/form-data; boundary=y7-boundary");
});

test("BDD-ATT-002 reports success without response or authorization content", async () => {
  const fetch = async (_url, request) => {
    assert.equal(request.body.byteLength, Number(request.headers["content-length"]));
    assert.match(request.headers.authorization, /^Bearer /u);
    return { ok: true, status: 202 };
  };

  const result = await runIngressProbe({
    authorization: "Bearer probe-secret-do-not-report",
    boundary: "y7-boundary",
    fetch,
    url: "https://function.example/probe",
  });

  assert.deepEqual(result, {
    accepted: true,
    fileBytes: TEN_MEBIBYTES,
    status: 202,
    totalBytes: result.totalBytes,
  });
  assert.ok(result.totalBytes > TEN_MEBIBYTES);
  assert.doesNotMatch(JSON.stringify(result), /secret|function\.example/iu);
});

test("BDD-ATT-002 reduces rejection and timeout to bounded facts", async () => {
  const rejected = await runIngressProbe({
    authorization: "Bearer hidden",
    boundary: "y7-boundary",
    fetch: async () => ({
      ok: false,
      status: 413,
      text: async () => "private-response-do-not-report",
    }),
    url: "https://function.example/probe",
  });
  const timedOut = await runIngressProbe({
    authorization: "Bearer hidden",
    boundary: "y7-boundary",
    fetch: async () => {
      throw new Error("private-timeout-do-not-report");
    },
    url: "https://function.example/probe",
  });

  assert.equal(rejected.accepted, false);
  assert.equal(rejected.status, 413);
  assert.deepEqual(timedOut, {
    accepted: false,
    fileBytes: TEN_MEBIBYTES,
    status: 0,
    totalBytes: timedOut.totalBytes,
  });
  assert.doesNotMatch(JSON.stringify({ rejected, timedOut }), /do-not-report/iu);
});
