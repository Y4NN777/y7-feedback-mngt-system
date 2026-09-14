import { stat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const webRoot = resolve(import.meta.dirname, "../apps/web");
const manifest = JSON.parse(
  await readFile(resolve(webRoot, "dist/.vite/manifest.json"), "utf8"),
);
const entry = manifest["index.html"];

if (!entry?.isEntry || typeof entry.file !== "string") {
  throw new Error("WEB_BUNDLE_ENTRY_MISSING");
}

const entryBytes = (await stat(resolve(webRoot, "dist", entry.file))).size;
const featureChunks = Object.values(manifest).filter(
  (chunk) => chunk?.isDynamicEntry === true,
).length;

if (entryBytes > 420_000) {
  throw new Error(`WEB_ENTRY_BUDGET_EXCEEDED:${String(entryBytes)}:420000`);
}
if (featureChunks < 7) {
  throw new Error(`WEB_FEATURE_CHUNKS_MISSING:${String(featureChunks)}:7`);
}

process.stdout.write(
  `${JSON.stringify({ result: "WEB_BUNDLE_BUDGET_PASSED", entryBytes, featureChunks })}\n`,
);
