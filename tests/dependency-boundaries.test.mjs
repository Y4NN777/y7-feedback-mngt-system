import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Appwrite schema and migration modules depend on a neutral schema contract", async () => {
  const [schema, day4, migration] = await Promise.all([
    source("functions/api/src/appwrite-schema.ts"),
    source("functions/api/src/appwrite-day4-migration.ts"),
    source("functions/api/src/appwrite-additive-migration.ts"),
  ]);

  assert.match(schema, /from "\.\/appwrite-schema-contract\.js"/u);
  assert.match(day4, /from "\.\/appwrite-schema-contract\.js"/u);
  assert.match(migration, /from "\.\/appwrite-schema-contract\.js"/u);
  assert.doesNotMatch(day4, /from "\.\/appwrite-schema\.js"/u);
  assert.doesNotMatch(migration, /from "\.\/appwrite-schema\.js"/u);
});

test("offline intake depends on component-neutral intake contracts", async () => {
  const [component, persistence] = await Promise.all([
    source("apps/web/src/FeedbackIntake.tsx"),
    source("apps/web/src/OfflineIntake.ts"),
  ]);

  assert.match(component, /from "\.\/FeedbackIntakeContracts"/u);
  assert.match(persistence, /from "\.\/FeedbackIntakeContracts"/u);
  assert.doesNotMatch(persistence, /from "\.\/FeedbackIntake"/u);
});
