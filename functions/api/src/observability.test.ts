import { describe, expect, it } from "vitest";

import { serializeOperationalEvent } from "./observability";

describe("safe operational telemetry", () => {
  it("BDD-OBS-002 retains only allowlisted operational fields", () => {
    const serialized = serializeOperationalEvent({
      event: "api.request.completed",
      correlationId: "018f4f7e-89ab-7def-8123-456789abcdef",
      environment: "preview",
      release: "commit-123",
      operation: "health",
      outcome: "success",
      statusCode: 200,
      durationMs: 4,
      accessProof: "proof-do-not-ship",
      authorization: "Bearer credential-do-not-ship",
      body: { message: "private-source-do-not-ship" },
    });

    expect(JSON.parse(serialized)).toEqual({
      event: "api.request.completed",
      correlationId: "018f4f7e-89ab-7def-8123-456789abcdef",
      environment: "preview",
      release: "commit-123",
      operation: "health",
      outcome: "success",
      statusCode: 200,
      durationMs: 4,
    });
    expect(serialized).not.toContain("do-not-ship");
  });

  it("BDD-OBS-002 rejects unrecognized event names", () => {
    expect(() =>
      serializeOperationalEvent({
        event: "private.payload.dump",
        correlationId: "018f4f7e-89ab-7def-8123-456789abcdef",
      }),
    ).toThrow("TELEMETRY_EVENT_INVALID");
  });
});
