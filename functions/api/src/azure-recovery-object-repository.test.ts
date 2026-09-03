import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  createAzureRecoveryObjectRepository,
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
      createIfNotExists: () => Promise.resolve(undefined),
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
});
