import { randomBytes } from "node:crypto";

import { Client, Storage } from "node-appwrite";
import { InputFile } from "node-appwrite/file";

import { parseServerConfig } from "@y7-feedback/config/server";

import {
  runAppwriteAntivirusEvidence,
  type AntivirusEvidenceStorage,
} from "./appwrite-antivirus-evidence.js";

function nodeStorageAdapter(storage: Storage): AntivirusEvidenceStorage {
  return {
    getBucket: (bucketId) => storage.getBucket({ bucketId }),
    createFile: async (input) => {
      await storage.createFile({
        bucketId: input.bucketId,
        fileId: input.fileId,
        file: InputFile.fromBuffer(input.bytes, input.name),
        permissions: [...input.permissions],
      });
    },
    getFile: async (input) => {
      await storage.getFile(input);
    },
    deleteFile: async (input) => {
      await storage.deleteFile(input);
    },
  };
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    throw new Error("APPWRITE_ANTIVIRUS_APPLY_REQUIRED");
  }
  const config = parseServerConfig(process.env);
  if (config.environment === "production") {
    throw new Error("APPWRITE_ANTIVIRUS_NON_PRODUCTION_REQUIRED");
  }
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const suffix = randomBytes(8).toString("hex");
  const result = await runAppwriteAntivirusEvidence(
    nodeStorageAdapter(new Storage(client)),
    {
      bucketId: config.appwriteSchema.attachmentBucketId,
      cleanFileId: `avc_${suffix}`,
      infectedFileId: `avi_${suffix}`,
    },
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

await main();
