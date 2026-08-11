import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { ValidatedFeedbackDraft } from "@y7-feedback/domain";

const keyLength = 32;
const nonceLength = 12;
const authTagLength = 16;
const proofLength = 43;

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function decodeBase64Url(value: string): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error("PROOF_ENVELOPE_INVALID");
  }
  return decoded;
}

export function createAccessProof(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAccessProof(proof: string): string {
  if (proof.length !== proofLength || !/^[A-Za-z0-9_-]+$/u.test(proof)) {
    throw new Error("ACCESS_PROOF_INVALID");
  }
  return `sha256:${digest(proof)}`;
}

export function matchesAccessProof(proof: string, verifier: string): boolean {
  try {
    const candidate = Buffer.from(hashAccessProof(proof), "utf8");
    const expected = Buffer.from(verifier, "utf8");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export interface ProofProtector {
  readonly sealProof: (proof: string) => string;
  readonly openProof: (protectedProof: string) => string;
}

export function createProofProtector(
  rawKey: Uint8Array,
  createNonce: () => Uint8Array = () => randomBytes(nonceLength),
): ProofProtector {
  const key = Buffer.from(rawKey);
  if (key.length !== keyLength) throw new Error("PROOF_KEY_INVALID");

  return {
    sealProof(proof) {
      hashAccessProof(proof);
      const nonce = Buffer.from(createNonce());
      if (nonce.length !== nonceLength) throw new Error("PROOF_NONCE_INVALID");
      const cipher = createCipheriv("aes-256-gcm", key, nonce, {
        authTagLength,
      });
      const ciphertext = Buffer.concat([cipher.update(proof, "utf8"), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return `v1.${nonce.toString("base64url")}.${ciphertext.toString("base64url")}.${authTag.toString("base64url")}`;
    },
    openProof(protectedProof) {
      const match = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u.exec(
        protectedProof,
      );
      if (!match) {
        throw new Error("PROOF_ENVELOPE_INVALID");
      }
      const nonce = decodeBase64Url(String(match[1]));
      const ciphertext = decodeBase64Url(String(match[2]));
      const authTag = decodeBase64Url(String(match[3]));
      if (nonce.length !== nonceLength || authTag.length !== authTagLength) {
        throw new Error("PROOF_ENVELOPE_INVALID");
      }
      const decipher = createDecipheriv("aes-256-gcm", key, nonce, {
        authTagLength,
      });
      decipher.setAuthTag(authTag);
      const proof = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
      hashAccessProof(proof);
      return proof;
    },
  };
}

export function digestValidatedDraft(draft: ValidatedFeedbackDraft): string {
  return `sha256:${digest(JSON.stringify(draft))}`;
}
