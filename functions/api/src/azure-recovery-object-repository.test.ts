import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  createAzureRecoveryObjectRepository,
  createAzureRecoveryRepositoryFromEnvironment,
  parseAzureRecoveryDestination,
} from "./azure-recovery-object-repository";

describe("Azure private recovery repository", () => {
  it("BDD-REC-009 accepts only an HTTPS account endpoint and a private container name", () => {
    expect(
      parseAzureRecoveryDestination({
        accountUrl: "https://y7recovery.blob.core.windows.net",
        containerName: "recovery-preview",
      }),
    ).toEqual({
      accountUrl: "https://y7recovery.blob.core.windows.net",
      containerName: "recovery-preview",
    });
    for (const candidate of [
      { accountUrl: "http://y7recovery.blob.core.windows.net", containerName: "ok" },
      { accountUrl: "https://example.com/path", containerName: "ok" },
      { accountUrl: "https://example.com", containerName: "recovery" },
      {
        accountUrl: "https://y7recovery.blob.core.windows.net/path",
        containerName: "recovery",
      },
      {
        accountUrl: "https://y7recovery.blob.core.windows.net",
        containerName: "Bad_Name",
      },
    ])
      expect(() => parseAzureRecoveryDestination(candidate)).toThrow(
        "RECOVERY_DESTINATION_INVALID",
      );
  });

  it("BDD-REC-010 maps conditional writes, reads and deletes without public access", async () => {
    const objects = new Map<string, Buffer>();
    const conditions: unknown[] = [];
    const container = {
      getProperties: () => Promise.resolve({}),
      getBlockBlobClient: (key: string) => ({
        uploadData: (value: Buffer, options: { conditions?: unknown }) => {
          conditions.push(options.conditions);
          if (options.conditions && objects.has(key)) {
            const error = new Error("exists") as Error & { statusCode: number };
            error.statusCode = 409;
            return Promise.reject(error);
          }
          objects.set(key, value);
          return Promise.resolve();
        },
        download: () => {
          const value = objects.get(key);
          return Promise.resolve({
            readableStreamBody: value ? Readable.from(value) : undefined,
          });
        },
        deleteIfExists: () => {
          objects.delete(key);
          return Promise.resolve();
        },
        exists: () => Promise.resolve(objects.has(key)),
      }),
    };
    const repository = createAzureRecoveryObjectRepository(container);
    await expect(
      repository.put("generation/a", new Uint8Array([1, 2]), { ifAbsent: true }),
    ).resolves.toBe("stored");
    await expect(
      repository.put("generation/a", new Uint8Array([3]), { ifAbsent: true }),
    ).resolves.toBe("exists");
    await expect(repository.get("generation/a")).resolves.toEqual(
      new Uint8Array([1, 2]),
    );
    await repository.delete("generation/a");
    await expect(repository.get("generation/a")).resolves.toBeUndefined();
    expect(conditions).toEqual([{ ifNoneMatch: "*" }, { ifNoneMatch: "*" }]);
  });

  it("BDD-REC-010A rejects a container with public blob access", async () => {
    const repository = createAzureRecoveryObjectRepository({
      getProperties: () => Promise.resolve({ blobPublicAccess: "blob" }),
      getBlockBlobClient: () => ({
        uploadData: () => Promise.resolve(),
        download: () => Promise.resolve({}),
        deleteIfExists: () => Promise.resolve(),
        exists: () => Promise.resolve(false),
      }),
    });
    await expect(repository.get("generation/a")).rejects.toThrow(
      "RECOVERY_DESTINATION_PUBLIC",
    );
  });

  it("BDD-REC-010B preserves unconditional errors and rejects missing bodies", async () => {
    const failure = new Error("azure unavailable");
    const repository = createAzureRecoveryObjectRepository({
      getProperties: () => Promise.resolve({}),
      getBlockBlobClient: () => ({
        uploadData: () => Promise.reject(failure),
        download: () => Promise.resolve({}),
        deleteIfExists: () => Promise.resolve(),
        exists: () => Promise.resolve(true),
      }),
    });
    await expect(
      repository.put("generation/a", new Uint8Array(), { ifAbsent: false }),
    ).rejects.toBe(failure);
    await expect(repository.get("generation/a")).rejects.toThrow(
      "RECOVERY_BLOB_BODY_MISSING",
    );
  });

  it("BDD-REC-010C reads string and typed-array stream chunks", async () => {
    const repository = createAzureRecoveryObjectRepository({
      getProperties: () => Promise.resolve({}),
      getBlockBlobClient: () => ({
        uploadData: () => Promise.resolve(),
        download: () =>
          Promise.resolve({
            readableStreamBody: Readable.from(["a", new Uint8Array([98])]),
          }),
        deleteIfExists: () => Promise.resolve(),
        exists: () => Promise.resolve(true),
      }),
    });
    await expect(repository.get("generation/a")).resolves.toEqual(
      new TextEncoder().encode("ab"),
    );
  });

  it("BDD-REC-010D composes the environment adapter without exposing credentials", async () => {
    const calls: string[] = [];
    const container = {
      getProperties: () => Promise.resolve({}),
      getBlockBlobClient: (key: string) => ({
        uploadData: () => Promise.resolve(),
        download: () => Promise.resolve({}),
        deleteIfExists: () => {
          calls.push(key);
          return Promise.resolve();
        },
        exists: () => Promise.resolve(false),
      }),
    };
    const repository = createAzureRecoveryRepositoryFromEnvironment(
      {
        AZURE_RECOVERY_ACCOUNT_URL: " https://y7recovery.blob.core.windows.net ",
        AZURE_RECOVERY_CONTAINER: " recovery ",
      },
      {
        service: (accountUrl) => {
          calls.push(accountUrl);
          return { getContainerClient: () => container } as never;
        },
      },
    );
    await repository.delete("generation/a");
    expect(calls).toEqual(["https://y7recovery.blob.core.windows.net", "generation/a"]);
  });

  it("BDD-REC-010E constructs the default workload-identity adapter lazily", () => {
    const repository = createAzureRecoveryRepositoryFromEnvironment({
      AZURE_RECOVERY_ACCOUNT_URL: "https://y7recovery.blob.core.windows.net",
      AZURE_RECOVERY_CONTAINER: "recovery",
    });
    expect(typeof repository.put).toBe("function");
    expect(typeof repository.get).toBe("function");
    expect(typeof repository.delete).toBe("function");
    for (const environment of [
      {},
      { AZURE_RECOVERY_ACCOUNT_URL: "https://y7recovery.blob.core.windows.net" },
      { AZURE_RECOVERY_CONTAINER: "recovery" },
    ])
      expect(() => createAzureRecoveryRepositoryFromEnvironment(environment)).toThrow(
        "RECOVERY_DESTINATION_INVALID",
      );
  });
});
