import { Buffer } from "node:buffer";

import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";

import type { RecoveryObjectRepository } from "./recovery-artifact.js";

interface AzureBlockBlobLike {
  uploadData(
    value: Buffer,
    options: { readonly conditions?: { readonly ifNoneMatch: "*" } },
  ): Promise<unknown>;
  download(): Promise<{
    readonly readableStreamBody?: NodeJS.ReadableStream | undefined;
  }>;
  deleteIfExists(): Promise<unknown>;
  exists(): Promise<boolean>;
}

interface AzureContainerLike {
  getProperties(): Promise<{ readonly blobPublicAccess?: unknown }>;
  getBlockBlobClient(key: string): AzureBlockBlobLike;
}

export function parseAzureRecoveryDestination(input: {
  readonly accountUrl: string;
  readonly containerName: string;
}) {
  try {
    const url = new URL(input.accountUrl);
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/" ||
      !url.hostname.endsWith(".blob.core.windows.net") ||
      !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/u.test(input.containerName)
    )
      throw new Error("invalid");
    return { accountUrl: url.origin, containerName: input.containerName };
  } catch {
    throw new Error("RECOVERY_DESTINATION_INVALID");
  }
}

async function streamBytes(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : typeof chunk === "string"
          ? Buffer.from(chunk)
          : Buffer.from(chunk),
    );
  return new Uint8Array(Buffer.concat(chunks));
}

export function createAzureRecoveryObjectRepository(
  container: AzureContainerLike,
): RecoveryObjectRepository {
  let initialized: Promise<unknown> | undefined;
  const initialize = () =>
    (initialized ??= container.getProperties().then((properties) => {
      if (properties.blobPublicAccess !== undefined)
        throw new Error("RECOVERY_DESTINATION_PUBLIC");
    }));
  return {
    async put(key, value, options) {
      await initialize();
      try {
        await container.getBlockBlobClient(key).uploadData(Buffer.from(value), {
          ...(options.ifAbsent ? { conditions: { ifNoneMatch: "*" } } : {}),
        });
        return "stored";
      } catch (error) {
        if (
          options.ifAbsent &&
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          error.statusCode === 409
        )
          return "exists";
        throw error;
      }
    },
    async get(key) {
      await initialize();
      const blob = container.getBlockBlobClient(key);
      if (!(await blob.exists())) return undefined;
      const response = await blob.download();
      if (!response.readableStreamBody) throw new Error("RECOVERY_BLOB_BODY_MISSING");
      return streamBytes(response.readableStreamBody);
    },
    async delete(key) {
      await initialize();
      await container.getBlockBlobClient(key).deleteIfExists();
    },
  };
}

export function createAzureRecoveryRepositoryFromEnvironment(
  environment: NodeJS.ProcessEnv,
  dependencies: {
    readonly service?: (
      accountUrl: string,
    ) => Pick<BlobServiceClient, "getContainerClient">;
  } = {},
): RecoveryObjectRepository {
  const destination = parseAzureRecoveryDestination({
    accountUrl: environment.AZURE_RECOVERY_ACCOUNT_URL?.trim() ?? "",
    containerName: environment.AZURE_RECOVERY_CONTAINER?.trim() ?? "",
  });
  const service = dependencies.service
    ? dependencies.service(destination.accountUrl)
    : new BlobServiceClient(destination.accountUrl, new DefaultAzureCredential());
  return createAzureRecoveryObjectRepository(
    service.getContainerClient(destination.containerName),
  );
}
