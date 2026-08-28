import { createHash } from "node:crypto";

export const previewFunctionId = "y7-feedback-api-preview";
export const productionFunctionId = "y7-feedback-api-production";

export interface AppwriteFunctionTarget {
  readonly id: typeof previewFunctionId | typeof productionFunctionId;
  readonly name: "Y7 Feedback API Preview" | "Y7 Feedback API Production";
}

export function resolveAppwriteFunctionTarget(
  environment: string | undefined,
): AppwriteFunctionTarget {
  if (environment === "preview") {
    return { id: previewFunctionId, name: "Y7 Feedback API Preview" };
  }
  if (environment === "production") {
    return { id: productionFunctionId, name: "Y7 Feedback API Production" };
  }
  throw new Error("APPWRITE_FUNCTION_DEPLOYMENT_ENVIRONMENT_INVALID");
}

export const appwriteFunctionVariableKeys = [
  "Y7_ENVIRONMENT",
  "APPWRITE_ENVIRONMENT",
  "APPWRITE_DATABASE_ID",
  "APPWRITE_WORKSPACES_TABLE_ID",
  "APPWRITE_WORKSPACE_MEMBERSHIPS_TABLE_ID",
  "APPWRITE_PROJECT_ASSIGNMENTS_TABLE_ID",
  "APPWRITE_PROJECT_SLUGS_TABLE_ID",
  "APPWRITE_PROJECTS_TABLE_ID",
  "APPWRITE_REPORTERS_TABLE_ID",
  "APPWRITE_FEEDBACK_TABLE_ID",
  "APPWRITE_LIFECYCLE_TABLE_ID",
  "APPWRITE_ACCESS_GRANTS_TABLE_ID",
  "APPWRITE_NOTIFICATIONS_TABLE_ID",
  "APPWRITE_OUTBOX_TABLE_ID",
  "APPWRITE_IDEMPOTENCY_TABLE_ID",
  "APPWRITE_ATTACHMENT_BUCKET_ID",
  "APPWRITE_ATTACHMENT_STAGING_TABLE_ID",
  "APPWRITE_ATTACHMENTS_TABLE_ID",
  "APPWRITE_PROVIDER_GRANTS_TABLE_ID",
  "APPWRITE_SOURCE_CONNECTIONS_TABLE_ID",
  "APPWRITE_ADMINISTRATION_AUDIT_TABLE_ID",
  "APPWRITE_ADMINISTRATION_IDEMPOTENCY_TABLE_ID",
  "ACCESS_PROOF_ENVELOPE_KEY",
  "PROVIDER_GRANT_ENVELOPE_KEY",
  "SENSITIVE_DATA_ACTIVE_KEY_ID",
  "SENSITIVE_DATA_ENVELOPE_KEYS",
  "RELEASE",
] as const;

export interface ExistingFunctionVariable {
  readonly id: string;
  readonly key: string;
}

export interface FunctionVariableAction {
  readonly kind: "create" | "update";
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly secret: true;
}

function variableId(key: string): string {
  return `cfg-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

export function planAppwriteFunctionVariables(
  environment: Readonly<Record<string, string | undefined>>,
  existing: readonly ExistingFunctionVariable[],
): readonly FunctionVariableAction[] {
  const existingByKey = new Map(existing.map((variable) => [variable.key, variable]));

  return appwriteFunctionVariableKeys.map((key) => {
    const value = environment[key]?.trim();
    if (value === undefined || value.length === 0) {
      throw new Error(`APPWRITE_FUNCTION_VARIABLE_MISSING:${key}`);
    }
    const current = existingByKey.get(key);
    return {
      kind: current === undefined ? "create" : "update",
      id: current?.id ?? variableId(key),
      key,
      value,
      secret: true,
    };
  });
}
