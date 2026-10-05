import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Appwrite schema and migration modules depend on a neutral schema contract", async () => {
  const [schema, controlPlane, migration] = await Promise.all([
    source("functions/api/src/migrations/schema/schema.ts"),
    source("functions/api/src/migrations/control-plane/control-plane-schema.ts"),
    source("functions/api/src/migrations/control-plane/additive-migration.ts"),
  ]);

  assert.match(schema, /from "\.\/schema-contract\.js"/u);
  assert.match(controlPlane, /from "\.\.\/schema\/schema-contract\.js"/u);
  assert.match(migration, /from "\.\.\/schema\/schema-contract\.js"/u);
  assert.doesNotMatch(controlPlane, /from "\.\.\/schema\/schema\.js"/u);
  assert.doesNotMatch(migration, /from "\.\.\/schema\/schema\.js"/u);
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
