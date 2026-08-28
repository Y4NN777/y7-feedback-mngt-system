import { Client, Functions, Query } from "node-appwrite";

import {
  planAppwriteFunctionVariables,
  resolveAppwriteFunctionTarget,
} from "./appwrite-function-variables.js";

if (!process.argv.includes("--apply")) {
  throw new Error("APPWRITE_FUNCTION_CONFIGURATION_REQUIRES_APPLY");
}

const endpoint = process.env.APPWRITE_ENDPOINT?.trim();
const projectId = process.env.APPWRITE_PROJECT_ID?.trim();
const apiKey = process.env.APPWRITE_API_KEY?.trim();
if (!endpoint || !projectId || !apiKey) {
  throw new Error("APPWRITE_FUNCTION_ADMIN_AUTHORITY_MISSING");
}
const target = resolveAppwriteFunctionTarget(process.env.Y7_ENVIRONMENT?.trim());

const functions = new Functions(
  new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey),
);
const current = await functions.listVariables({
  functionId: target.id,
  queries: [Query.limit(100)],
  total: false,
});
const actions = planAppwriteFunctionVariables(
  process.env,
  current.variables.map((variable) => ({ id: variable.$id, key: variable.key })),
);

let created = 0;
let updated = 0;
for (const action of actions) {
  if (action.kind === "create") {
    await functions.createVariable({
      functionId: target.id,
      variableId: action.id,
      key: action.key,
      value: action.value,
      secret: action.secret,
    });
    created += 1;
  } else {
    await functions.updateVariable({
      functionId: target.id,
      variableId: action.id,
      key: action.key,
      value: action.value,
      secret: action.secret,
    });
    updated += 1;
  }
}

console.log(
  JSON.stringify({
    functionId: target.id,
    configured: actions.length,
    created,
    updated,
    staticApiKeyExcluded: true,
  }),
);
