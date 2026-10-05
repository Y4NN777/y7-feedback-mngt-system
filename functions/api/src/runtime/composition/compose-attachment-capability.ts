import type { ServerConfig } from "@y7-feedback/config/server";

import type { AccountlessAccessCoordinator } from "../../accountless-access.js";
import { createNodeAppwriteAttachmentAcceptanceStore } from "../../appwrite-attachment-acceptance-store.js";
import { createNodeAppwritePrivateAttachmentStorage } from "../../appwrite-private-attachment-storage.js";
import { createAttachmentDownload } from "../../attachment-download.js";
import { createAttachmentStagingTokenCodec } from "../../attachment-staging-token.js";
import { createAttachmentStaging } from "../../attachment-staging.js";
import { validateAttachment } from "../../attachment-validation.js";
import { createClamAvHttpScanner } from "../../clamav-http-scanner.js";
import { createReporterAttachmentDownload } from "../../reporter-attachment-download.js";
import type { AppwriteSensitivePersistence } from "../../sensitive-data-protector.js";
import type { ApplicationRuntime } from "./application-runtime.js";

export function composeAttachmentCapability(
  config: ServerConfig,
  runtime: ApplicationRuntime,
  sensitive: AppwriteSensitivePersistence,
  accountless: AccountlessAccessCoordinator,
) {
  const metadata = createNodeAppwriteAttachmentAcceptanceStore(
    runtime.tables,
    {
      databaseId: config.appwriteSchema.databaseId,
      stagingTableId: config.appwriteSchema.attachmentStagingTableId,
      attachmentsTableId: config.appwriteSchema.attachmentsTableId,
    },
    sensitive,
  );
  const storage = createNodeAppwritePrivateAttachmentStorage(
    runtime.storage,
    runtime.tables,
    {
      bucketId: config.appwriteSchema.attachmentBucketId,
      databaseId: config.appwriteSchema.databaseId,
      stagingTableId: config.appwriteSchema.attachmentStagingTableId,
    },
  );
  const malwareScanner = config.antivirusScanner
    ? createClamAvHttpScanner({
        endpoint: config.antivirusScanner.endpoint,
        keyId: config.antivirusScanner.keyId,
        hmacKey: Buffer.from(config.antivirusScanner.hmacKey, "base64url"),
        timeoutMs: config.antivirusScanner.timeoutMs,
      })
    : undefined;
  const stagingTokens = malwareScanner
    ? createAttachmentStagingTokenCodec(sensitive, {
        tableId: config.appwriteSchema.attachmentsTableId,
        now: runtime.nowIso,
        ttlMs: 15 * 60 * 1_000,
      })
    : undefined;
  const staging =
    malwareScanner && stagingTokens
      ? createAttachmentStaging(storage, stagingTokens, {
          validate: (candidate) => validateAttachment(candidate, { malwareScanner }),
          createAttachmentId: runtime.createId,
          createObjectId: () => `private/${runtime.createId()}`,
          now: runtime.nowIso,
        })
      : undefined;

  return {
    metadata,
    storage,
    staging,
    stagingTokens,
    reporterDownload: createReporterAttachmentDownload(
      accountless,
      createAttachmentDownload(metadata, storage),
    ),
  };
}
