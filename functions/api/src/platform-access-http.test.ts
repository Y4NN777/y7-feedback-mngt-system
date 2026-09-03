import { describe, expect, it, vi } from "vitest";

import { createPlatformAccessHttp } from "./platform-access-http";
import type { PlatformAccessOutcome } from "./platform-access";

function setup(outcome: PlatformAccessOutcome) {
  const execute = vi.fn(
    (input: { readonly jwt: string; readonly command: unknown }) => {
      void input;
      return Promise.resolve(outcome);
    },
  );
  return { execute, http: createPlatformAccessHttp({ execute }) };
}

const request = {
  method: "POST",
  path: "/v1/platform/exceptional-access/commands",
  headers: { Authorization: "Bearer jwt_1" },
  body: { kind: "deny", grantId: "grant_1", expectedRevision: 0 },
} as const;

describe("Platform exceptional access HTTP contract", () => {
  it("BDD-PLAT-120 accepts only the exact command route and server JWT", async () => {
    const candidate = setup({
      status: "ok",
      result: {
        disposition: "applied",
        grantId: "grant_1",
        state: "denied",
        revision: 1,
      },
    });
    await expect(candidate.http.handle(request)).resolves.toEqual({
      statusCode: 200,
      body: {
        status: "ok",
        result: {
          disposition: "applied",
          grantId: "grant_1",
          state: "denied",
          revision: 1,
        },
      },
    });
    expect(candidate.execute).toHaveBeenCalledWith({
      jwt: "jwt_1",
      command: request.body,
    });
    await expect(
      candidate.http.handle({ ...request, method: "GET" }),
    ).resolves.toBeUndefined();
    await expect(
      candidate.http.handle({ ...request, path: "/v1/platform/other" }),
    ).resolves.toBeUndefined();
  });

  it("BDD-PLAT-121 denies missing, malformed and oversized credentials", async () => {
    const candidate = setup({ status: "denied" });
    for (const value of [
      { headers: {} },
      { headers: { authorization: "Basic value" } },
      { headers: { authorization: `Bearer ${"a".repeat(4097)}` } },
      { headers: { authorization: "Bearer jwt_1" }, body: [] },
    ]) {
      await expect(candidate.http.handle({ ...request, ...value })).resolves.toEqual({
        statusCode: 403,
        body: { error: "ERR-PLATFORM-ACCESS-DENIED" },
      });
    }
    expect(candidate.execute).not.toHaveBeenCalled();
  });

  it("BDD-PLAT-122 maps stable non-disclosing command outcomes", async () => {
    for (const [outcome, expected] of [
      ["invalid", [400, "ERR-PLATFORM-ACCESS-INVALID"]],
      ["denied", [403, "ERR-PLATFORM-ACCESS-DENIED"]],
      ["conflict", [409, "ERR-PLATFORM-ACCESS-CONFLICT"]],
      ["retryable", [503, "ERR-PLATFORM-ACCESS-RETRYABLE"]],
    ] as const) {
      await expect(setup({ status: outcome }).http.handle(request)).resolves.toEqual({
        statusCode: expected[0],
        body: { error: expected[1] },
      });
    }
  });
});
