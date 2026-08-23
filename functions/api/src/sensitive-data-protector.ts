import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SensitiveFieldContext {
  readonly environment: string;
  readonly tableId: string;
  readonly rowId: string;
  readonly field: string;
}

export interface SensitiveEncryptionKey {
  readonly id: string;
  readonly material: Uint8Array;
}

export interface SensitiveDataProtector {
  readonly seal: (context: SensitiveFieldContext, plaintext: string) => string;
  readonly open: (context: SensitiveFieldContext, envelope: string) => string;
}

export interface AppwriteSensitivePersistence {
  readonly environment: string;
  readonly protector: SensitiveDataProtector;
}

const keyLength = 32;
const nonceLength = 12;
const authTagLength = 16;
const maximumPlaintextBytes = 1_000_000;
const keyIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u;
const envelopePattern =
  /^v1\.([A-Za-z0-9][A-Za-z0-9_-]{0,31})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u;

function canonicalBase64Url(value: string): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error("SENSITIVE_ENVELOPE_INVALID");
  }
  return decoded;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function contextValue(value: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > maximum ||
    hasControlCharacter(value)
  ) {
    throw new Error("SENSITIVE_CONTEXT_INVALID");
  }
  return value;
}

function associatedData(context: SensitiveFieldContext): Buffer {
  const values = [
    contextValue(context.environment, 32),
    contextValue(context.tableId, 36),
    contextValue(context.rowId, 500),
    contextValue(context.field, 64),
  ];
  return Buffer.from(`y7-sensitive:v1:${JSON.stringify(values)}`, "utf8");
}

function validatePlaintext(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  if (!value || bytes.length > maximumPlaintextBytes) {
    throw new Error("SENSITIVE_PLAINTEXT_INVALID");
  }
  return bytes;
}

export function createSensitiveDataProtector(
  activeKeyId: string,
  keys: readonly SensitiveEncryptionKey[],
  createNonce: () => Uint8Array = () => randomBytes(nonceLength),
): SensitiveDataProtector {
  if (!keyIdPattern.test(activeKeyId) || keys.length === 0) {
    throw new Error("SENSITIVE_KEYRING_INVALID");
  }
  const keyring = new Map<string, Buffer>();
  const materialFingerprints = new Set<string>();
  for (const candidate of keys) {
    const key = Buffer.from(candidate.material);
    const fingerprint = key.toString("hex");
    if (
      !keyIdPattern.test(candidate.id) ||
      key.length !== keyLength ||
      keyring.has(candidate.id) ||
      materialFingerprints.has(fingerprint)
    ) {
      throw new Error("SENSITIVE_KEYRING_INVALID");
    }
    keyring.set(candidate.id, key);
    materialFingerprints.add(fingerprint);
  }
  const activeKey = keyring.get(activeKeyId);
  if (!activeKey) throw new Error("SENSITIVE_KEYRING_INVALID");

  return {
    seal(context, plaintext) {
      const aad = associatedData(context);
      const bytes = validatePlaintext(plaintext);
      const nonce = Buffer.from(createNonce());
      if (nonce.length !== nonceLength) {
        throw new Error("SENSITIVE_NONCE_INVALID");
      }
      const cipher = createCipheriv("aes-256-gcm", activeKey, nonce, {
        authTagLength,
      });
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
      return `v1.${activeKeyId}.${nonce.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
    },
    open(context, envelope) {
      try {
        const aad = associatedData(context);
        const match = envelopePattern.exec(envelope);
        if (!match) throw new Error("SENSITIVE_ENVELOPE_INVALID");
        const key = keyring.get(String(match[1]));
        if (!key) throw new Error("SENSITIVE_ENVELOPE_INVALID");
        const nonce = canonicalBase64Url(String(match[2]));
        const ciphertext = canonicalBase64Url(String(match[3]));
        const authTag = canonicalBase64Url(String(match[4]));
        if (
          nonce.length !== nonceLength ||
          ciphertext.length === 0 ||
          authTag.length !== authTagLength
        ) {
          throw new Error("SENSITIVE_ENVELOPE_INVALID");
        }
        const decipher = createDecipheriv("aes-256-gcm", key, nonce, {
          authTagLength,
        });
        decipher.setAAD(aad);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
          "utf8",
        );
      } catch {
        throw new Error("SENSITIVE_ENVELOPE_INVALID");
      }
    },
  };
}
