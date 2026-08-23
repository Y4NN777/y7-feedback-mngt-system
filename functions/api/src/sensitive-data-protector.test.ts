import { describe, expect, it } from "vitest";

import { createSensitiveDataProtector } from "./sensitive-data-protector";

const oldKey = new Uint8Array(32).fill(7);
const currentKey = new Uint8Array(32).fill(8);
const nonce = new Uint8Array(12).fill(9);
const context = {
  environment: "preview",
  tableId: "feedback",
  rowId: "feedback_1",
  field: "originalSourceJson",
} as const;

function protector() {
  return createSensitiveDataProtector(
    "data_2026_08",
    [
      { id: "data_2026_07", material: oldKey },
      { id: "data_2026_08", material: currentKey },
    ],
    () => nonce,
  );
}

describe("sensitive data protector", () => {
  it("BDD-DATA-ENC-001 stores authenticated ciphertext bound to its exact context", () => {
    const plaintext = JSON.stringify({ problem: "Private balance mismatch" });
    const envelope = protector().seal(context, plaintext);

    expect(envelope).toMatch(
      /^v1\.data_2026_08\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
    );
    expect(envelope).not.toContain("Private");
    expect(protector().open(context, envelope)).toBe(plaintext);
  });

  it("BDD-DATA-ENC-002 rejects substitution, tampering, unknown keys, and malformed envelopes uniformly", () => {
    const envelope = protector().seal(context, "sensitive");
    const altered = `${envelope.slice(0, -1)}${envelope.endsWith("A") ? "B" : "A"}`;
    const wrongContext = { ...context, rowId: "feedback_2" };
    const unknownKey = envelope.replace("data_2026_08", "data_unknown");

    for (const [candidateContext, candidate] of [
      [wrongContext, envelope],
      [context, altered],
      [context, unknownKey],
      [context, "invalid"],
      [context, "v1.data_2026_08.AA.AA.AA"],
      [context, "v1.data_2026_08.A.A.A"],
    ] as const) {
      expect(() => protector().open(candidateContext, candidate)).toThrow(
        "SENSITIVE_ENVELOPE_INVALID",
      );
    }
  });

  it("BDD-DATA-ENC-003 opens prior-key envelopes and seals only with the active key", () => {
    const prior = createSensitiveDataProtector(
      "data_2026_07",
      [{ id: "data_2026_07", material: oldKey }],
      () => nonce,
    );
    const oldEnvelope = prior.seal(context, "before rotation");

    expect(protector().open(context, oldEnvelope)).toBe("before rotation");
    expect(protector().seal(context, "after rotation")).toMatch(/^v1\.data_2026_08\./u);
  });

  it("BDD-DATA-ENC-004 rejects invalid key rings, contexts, nonces, and plaintext bounds", () => {
    expect(() => createSensitiveDataProtector("missing", [])).toThrow(
      "SENSITIVE_KEYRING_INVALID",
    );
    expect(() =>
      createSensitiveDataProtector("missing", [
        { id: "current", material: currentKey },
      ]),
    ).toThrow("SENSITIVE_KEYRING_INVALID");
    expect(() =>
      createSensitiveDataProtector("bad/id", [{ id: "bad/id", material: currentKey }]),
    ).toThrow("SENSITIVE_KEYRING_INVALID");
    expect(() =>
      createSensitiveDataProtector("current", [
        { id: "current", material: new Uint8Array(31) },
      ]),
    ).toThrow("SENSITIVE_KEYRING_INVALID");
    expect(() =>
      createSensitiveDataProtector("current", [
        { id: "current", material: currentKey },
        { id: "duplicate", material: currentKey },
      ]),
    ).toThrow("SENSITIVE_KEYRING_INVALID");
    expect(() => protector().seal({ ...context, field: "" }, "value")).toThrow(
      "SENSITIVE_CONTEXT_INVALID",
    );
    expect(() =>
      protector().seal({ ...context, environment: "x".repeat(33) }, "value"),
    ).toThrow("SENSITIVE_CONTEXT_INVALID");
    expect(() =>
      protector().seal({ ...context, field: "bad\nfield" }, "value"),
    ).toThrow("SENSITIVE_CONTEXT_INVALID");
    expect(() =>
      protector().seal({ ...context, field: "bad\u007Ffield" }, "value"),
    ).toThrow("SENSITIVE_CONTEXT_INVALID");
    expect(() =>
      protector().seal({ ...context, field: 7 as unknown as string }, "value"),
    ).toThrow("SENSITIVE_CONTEXT_INVALID");
    expect(() => protector().seal(context, "")).toThrow("SENSITIVE_PLAINTEXT_INVALID");
    expect(() => protector().seal(context, "x".repeat(1_000_001))).toThrow(
      "SENSITIVE_PLAINTEXT_INVALID",
    );
    const invalidNonce = createSensitiveDataProtector(
      "current",
      [{ id: "current", material: currentKey }],
      () => new Uint8Array(11),
    );
    expect(() => invalidNonce.seal(context, "value")).toThrow(
      "SENSITIVE_NONCE_INVALID",
    );
    expect(
      createSensitiveDataProtector("current", [
        { id: "current", material: currentKey },
      ]).seal(context, "default nonce"),
    ).toMatch(/^v1\.current\./u);
  });
});
