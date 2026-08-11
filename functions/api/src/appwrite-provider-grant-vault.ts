import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

import type { TablesDB } from "node-appwrite";

import type { SourceProvider } from "@y7-feedback/domain";

import type { ProviderGrantMaterial, ProviderGrantVault } from "./source-provider";

export interface AppwriteProviderGrantSchema {
  readonly databaseId: string;
  readonly providerGrantsTableId: string;
}

export interface AppwriteProviderGrantTablesPort {
  createRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: readonly string[];
  }): Promise<unknown>;
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<unknown>;
  deleteRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<unknown>;
}

export interface ProviderGrantVaultDependencies {
  readonly createReference: () => string;
  readonly createNonce: () => Uint8Array;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const envelopePattern = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u;
const keyLength = 32;
const nonceLength = 12;
const authTagLength = 16;

const defaultDependencies: ProviderGrantVaultDependencies = {
  createReference: randomUUID,
  createNonce: () => randomBytes(nonceLength),
};

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProvider(value: unknown): value is SourceProvider {
  return value === "github" || value === "gitlab";
}

function required(value: unknown, maximum = 10_000): string {
  if (typeof value !== "string") {
    throw new Error("APPWRITE_PROVIDER_GRANT_INVALID");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error("APPWRITE_PROVIDER_GRANT_INVALID");
  }
  return normalized;
}

function optional(value: unknown): string | undefined {
  return value === undefined ? undefined : required(value);
}

function canonicalInstant(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const instant = required(value, 40);
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== instant) {
    throw new Error("APPWRITE_PROVIDER_GRANT_INVALID");
  }
  return instant;
}

function validateMaterial(value: unknown): ProviderGrantMaterial {
  if (!isObject(value)) throw new Error("APPWRITE_PROVIDER_GRANT_INVALID");
  const allowed = new Set(["accessToken", "refreshToken", "expiresAt"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("APPWRITE_PROVIDER_GRANT_INVALID");
  }
  const accessToken = required(value.accessToken);
  const refreshToken = optional(value.refreshToken);
  const expiresAt = canonicalInstant(value.expiresAt);
  return {
    accessToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

function canonicalBase64Url(value: string): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error("APPWRITE_PROVIDER_GRANT_INVALID");
  }
  return decoded;
}

function associatedData(provider: SourceProvider, reference: string): Buffer {
  return Buffer.from(`provider-grant:v1:${provider}:${reference}`, "utf8");
}

function parseRow(value: unknown, provider: SourceProvider, reference: string): string {
  if (!isObject(value)) throw new Error("APPWRITE_PROVIDER_GRANT_INVALID");
  if (
    required(value.$id, 36) !== reference ||
    !isProvider(value.provider) ||
    value.provider !== provider
  ) {
    throw new Error("APPWRITE_PROVIDER_GRANT_INVALID");
  }
  return required(value.envelope, 50_000);
}

export function createAppwriteProviderGrantVault(
  tables: AppwriteProviderGrantTablesPort,
  schema: AppwriteProviderGrantSchema,
  rawKey: Uint8Array,
  dependencies: ProviderGrantVaultDependencies = defaultDependencies,
): ProviderGrantVault {
  if (
    !appwriteId.test(schema.databaseId) ||
    !appwriteId.test(schema.providerGrantsTableId) ||
    schema.databaseId === schema.providerGrantsTableId
  ) {
    throw new Error("APPWRITE_PROVIDER_GRANT_SCHEMA_INVALID");
  }
  const key = Buffer.from(rawKey);
  if (key.length !== keyLength) {
    throw new Error("APPWRITE_PROVIDER_GRANT_KEY_INVALID");
  }

  function validateReference(value: string): string {
    if (!appwriteId.test(value)) {
      throw new Error("APPWRITE_PROVIDER_GRANT_REFERENCE_INVALID");
    }
    return value;
  }

  async function row(provider: SourceProvider, reference: string): Promise<string> {
    const validatedReference = validateReference(reference);
    const stored = await tables.getRow({
      databaseId: schema.databaseId,
      tableId: schema.providerGrantsTableId,
      rowId: validatedReference,
    });
    return parseRow(stored, provider, validatedReference);
  }

  return {
    async seal(provider, value) {
      if (!isProvider(provider)) throw new Error("APPWRITE_PROVIDER_GRANT_INVALID");
      const material = validateMaterial(value);
      const reference = validateReference(dependencies.createReference());
      const nonce = Buffer.from(dependencies.createNonce());
      if (nonce.length !== nonceLength) {
        throw new Error("APPWRITE_PROVIDER_GRANT_NONCE_INVALID");
      }
      const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength });
      cipher.setAAD(associatedData(provider, reference));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(material), "utf8"),
        cipher.final(),
      ]);
      const envelope = `v1.${nonce.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
      await tables.createRow({
        databaseId: schema.databaseId,
        tableId: schema.providerGrantsTableId,
        rowId: reference,
        data: { provider, envelope },
        permissions: [],
      });
      return reference;
    },

    async open(provider, encryptedGrantRef) {
      try {
        if (!isProvider(provider)) {
          throw new Error("APPWRITE_PROVIDER_GRANT_INVALID");
        }
        const reference = validateReference(encryptedGrantRef);
        const envelope = await row(provider, reference);
        const match = envelopePattern.exec(envelope);
        if (!match) throw new Error("APPWRITE_PROVIDER_GRANT_INVALID");
        const nonce = canonicalBase64Url(String(match[1]));
        const ciphertext = canonicalBase64Url(String(match[2]));
        const authTag = canonicalBase64Url(String(match[3]));
        if (
          nonce.length !== nonceLength ||
          ciphertext.length === 0 ||
          authTag.length !== authTagLength
        ) {
          throw new Error("APPWRITE_PROVIDER_GRANT_INVALID");
        }
        const decipher = createDecipheriv("aes-256-gcm", key, nonce, {
          authTagLength,
        });
        decipher.setAAD(associatedData(provider, reference));
        decipher.setAuthTag(authTag);
        const plaintext = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]).toString("utf8");
        return validateMaterial(JSON.parse(plaintext) as unknown);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "APPWRITE_PROVIDER_GRANT_REFERENCE_INVALID"
        ) {
          throw error;
        }
        throw new Error("APPWRITE_PROVIDER_GRANT_INVALID");
      }
    },

    async remove(provider, encryptedGrantRef) {
      if (!isProvider(provider)) throw new Error("APPWRITE_PROVIDER_GRANT_INVALID");
      const reference = validateReference(encryptedGrantRef);
      await row(provider, reference);
      await tables.deleteRow({
        databaseId: schema.databaseId,
        tableId: schema.providerGrantsTableId,
        rowId: reference,
      });
    },
  };
}

export function createNodeAppwriteProviderGrantVault(
  tables: TablesDB,
  schema: AppwriteProviderGrantSchema,
  rawKey: Uint8Array,
  dependencies: ProviderGrantVaultDependencies = defaultDependencies,
): ProviderGrantVault {
  return createAppwriteProviderGrantVault(
    {
      createRow: (input) =>
        tables.createRow({ ...input, permissions: [...input.permissions] }),
      getRow: (input) => tables.getRow(input),
      deleteRow: (input) => tables.deleteRow(input),
    },
    schema,
    rawKey,
    dependencies,
  );
}
