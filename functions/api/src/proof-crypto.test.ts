import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ValidatedFeedbackDraft } from "@y7-feedback/domain";

import {
  createAccessProof,
  createProofProtector,
  digestValidatedDraft,
  hashAccessProof,
  matchesAccessProof,
} from "./proof-crypto";

const draft: ValidatedFeedbackDraft = {
  projectId: "wisemoney",
  workspaceId: "personal",
  type: "review",
  originalSource: { type: "review", experience: "Rapide", appreciation: "Clair" },
  reporter: { kind: "unidentified" },
  context: [],
  attachmentNames: [],
  derivedClassification: null,
};

describe("trusted Access Proof cryptography", () => {
  it("creates a high-entropy URL-safe proof and one-way verifier", () => {
    const proof = createAccessProof();
    const verifier = hashAccessProof(proof);

    expect(proof).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(verifier).toMatch(/^sha256:[A-Za-z0-9_-]{43}$/u);
    expect(verifier).not.toContain(proof);
    expect(matchesAccessProof(proof, verifier)).toBe(true);
    const wrongProof = `${proof.slice(0, -1)}${proof.endsWith("A") ? "B" : "A"}`;
    expect(matchesAccessProof(wrongProof, verifier)).toBe(false);
    expect(matchesAccessProof(proof, "malformed")).toBe(false);
    expect(matchesAccessProof("short", verifier)).toBe(false);
    expect(() => hashAccessProof(`${"A".repeat(42)}!`)).toThrow();
  });

  it("seals retry material with authenticated encryption and detects alteration", () => {
    const key = Buffer.alloc(32, 7);
    const nonce = Buffer.alloc(12, 3);
    const protector = createProofProtector(key, () => nonce);
    const proof = createAccessProof();

    const sealed = protector.sealProof(proof);

    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    expect(sealed).not.toContain(proof);
    expect(protector.openProof(sealed)).toBe(proof);
    const altered = `${sealed.slice(0, -1)}${sealed.endsWith("A") ? "B" : "A"}`;
    expect(() => protector.openProof(altered)).toThrow();
    expect(() => createProofProtector(Buffer.alloc(32, 8)).openProof(sealed)).toThrow();
    expect(() => protector.openProof("invalid-envelope")).toThrow();
    expect(() => protector.openProof("v1.A.A.A")).toThrow();
    expect(() =>
      protector.openProof(
        `v1.${Buffer.alloc(12).toString("base64url")}.AA.${Buffer.alloc(1).toString("base64url")}`,
      ),
    ).toThrow();
  });

  it("rejects invalid encryption keys and nonces", () => {
    expect(() => createProofProtector(Buffer.alloc(31))).toThrow();
    const proof = createAccessProof();
    expect(() =>
      createProofProtector(Buffer.alloc(32), () => randomBytes(11)).sealProof(proof),
    ).toThrow();
    const defaultProtector = createProofProtector(Buffer.alloc(32, 5));
    expect(defaultProtector.openProof(defaultProtector.sealProof(proof))).toBe(proof);
  });

  it("digests validated payload deterministically and detects semantic changes", () => {
    const same = { ...draft };
    const changed: ValidatedFeedbackDraft = {
      ...draft,
      originalSource: {
        type: "review",
        experience: "Plus lente",
        appreciation: "Clair",
      },
    };

    expect(digestValidatedDraft(draft)).toBe(digestValidatedDraft(same));
    expect(digestValidatedDraft(changed)).not.toBe(digestValidatedDraft(draft));
  });
});
