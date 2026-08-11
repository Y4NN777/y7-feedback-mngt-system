import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("BDD-VER-001 keeps Vercel shell caching public and update-safe", async () => {
  const policy = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  const serialized = JSON.stringify(policy);
  const immutable = policy.headers.find((entry) => entry.source === "/assets/(.*)");
  const revalidated = policy.headers.find(
    (entry) => entry.source === "/(index.html|manifest.webmanifest|sw.js)",
  );

  assert.match(JSON.stringify(immutable), /public, max-age=31536000, immutable/u);
  assert.match(JSON.stringify(revalidated), /max-age=0, must-revalidate/u);
  assert.doesNotMatch(serialized, /destination":"https?:.*appwrite/iu);
  assert.doesNotMatch(serialized, /authorization|cookie|access.proof/iu);
});
