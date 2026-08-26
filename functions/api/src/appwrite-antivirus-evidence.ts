const maximumAttachmentBytes = 10 * 1024 * 1024;

export interface AntivirusEvidenceStorage {
  getBucket(bucketId: string): Promise<unknown>;
  createFile(input: {
    readonly bucketId: string;
    readonly fileId: string;
    readonly bytes: Uint8Array;
    readonly name: string;
    readonly permissions: readonly string[];
  }): Promise<void>;
  getFile(input: { readonly bucketId: string; readonly fileId: string }): Promise<void>;
  deleteFile(input: {
    readonly bucketId: string;
    readonly fileId: string;
  }): Promise<void>;
}

export interface AntivirusEvidenceIds {
  readonly bucketId: string;
  readonly cleanFileId: string;
  readonly infectedFileId: string;
}

export interface AntivirusEvidenceResult {
  readonly bucketPolicy: "verified";
  readonly cleanUpload: "accepted_and_removed";
  readonly infectedUpload: "rejected_without_residue";
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbsent(error: unknown): boolean {
  return isObject(error) && error.code === 404;
}

async function assertAbsent(
  storage: AntivirusEvidenceStorage,
  bucketId: string,
  fileId: string,
): Promise<void> {
  try {
    await storage.getFile({ bucketId, fileId });
  } catch (error) {
    if (isAbsent(error)) return;
    throw error;
  }
  throw new Error("APPWRITE_ANTIVIRUS_RESIDUE_DETECTED");
}

function eicarTestBytes(): Uint8Array {
  const prefix = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$";
  const marker = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
  return new TextEncoder().encode(`${prefix}${marker}`);
}

export async function runAppwriteAntivirusEvidence(
  storage: AntivirusEvidenceStorage,
  ids: AntivirusEvidenceIds,
): Promise<AntivirusEvidenceResult> {
  const bucket = await storage.getBucket(ids.bucketId);
  if (
    !isObject(bucket) ||
    bucket.fileSecurity !== true ||
    bucket.encryption !== true ||
    bucket.antivirus !== true ||
    bucket.maximumFileSize !== maximumAttachmentBytes ||
    !Array.isArray(bucket.$permissions) ||
    bucket.$permissions.length !== 0
  ) {
    throw new Error("APPWRITE_ANTIVIRUS_BUCKET_POLICY_INVALID");
  }

  let cleanCreated = false;
  try {
    await storage.createFile({
      bucketId: ids.bucketId,
      fileId: ids.cleanFileId,
      bytes: new TextEncoder().encode("Y7 clean antivirus probe"),
      name: "clean-probe.txt",
      permissions: [],
    });
    cleanCreated = true;
    await storage.getFile({ bucketId: ids.bucketId, fileId: ids.cleanFileId });
  } finally {
    if (cleanCreated) {
      await storage.deleteFile({ bucketId: ids.bucketId, fileId: ids.cleanFileId });
      await assertAbsent(storage, ids.bucketId, ids.cleanFileId);
    }
  }

  let rejected = false;
  try {
    await storage.createFile({
      bucketId: ids.bucketId,
      fileId: ids.infectedFileId,
      bytes: eicarTestBytes(),
      name: "eicar.com",
      permissions: [],
    });
  } catch {
    rejected = true;
  }
  if (!rejected) {
    await storage.deleteFile({ bucketId: ids.bucketId, fileId: ids.infectedFileId });
    await assertAbsent(storage, ids.bucketId, ids.infectedFileId);
    throw new Error("APPWRITE_ANTIVIRUS_INFECTED_UPLOAD_ACCEPTED");
  }
  await assertAbsent(storage, ids.bucketId, ids.infectedFileId);

  return {
    bucketPolicy: "verified",
    cleanUpload: "accepted_and_removed",
    infectedUpload: "rejected_without_residue",
  };
}
