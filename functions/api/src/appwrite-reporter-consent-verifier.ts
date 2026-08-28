import type { TablesDB } from "node-appwrite";

import type { AccountlessAccessCoordinator } from "./accountless-access.js";
import type { ReporterConsentProofVerifier } from "./external-issue-coordination.js";

export interface AppwriteReporterConsentTablesPort {
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<unknown>;
}

export interface AppwriteReporterConsentSchema {
  readonly databaseId: string;
  readonly feedbackTableId: string;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createAppwriteReporterConsentVerifier(
  accountless: Pick<AccountlessAccessCoordinator, "authorize">,
  tables: AppwriteReporterConsentTablesPort,
  schema: AppwriteReporterConsentSchema,
): ReporterConsentProofVerifier {
  if (!identifier.test(schema.databaseId) || !identifier.test(schema.feedbackTableId)) {
    throw new Error("APPWRITE_REPORTER_CONSENT_SCHEMA_INVALID");
  }
  return {
    async verify(input) {
      const authorized = await accountless.authorize(input);
      if (authorized.status !== "ok") return { status: authorized.status };
      try {
        const row = await tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.feedbackTableId,
          rowId: authorized.feedbackId,
        });
        if (
          !object(row) ||
          row.$id !== authorized.feedbackId ||
          typeof row.reporterId !== "string" ||
          !identifier.test(row.reporterId) ||
          typeof row.workspaceId !== "string" ||
          !identifier.test(row.workspaceId) ||
          typeof row.projectId !== "string" ||
          !identifier.test(row.projectId) ||
          (row.deletedAt !== undefined && row.deletedAt !== null)
        ) {
          return { status: "retryable" };
        }
        return {
          status: "verified",
          feedbackId: authorized.feedbackId,
          reporterId: row.reporterId,
          workspaceId: row.workspaceId,
          projectId: row.projectId,
        };
      } catch {
        return { status: "retryable" };
      }
    },
  };
}

/* v8 ignore start -- Thin Node SDK composition wrapper. */
export function createNodeAppwriteReporterConsentVerifier(
  accountless: Pick<AccountlessAccessCoordinator, "authorize">,
  tables: TablesDB,
  schema: AppwriteReporterConsentSchema,
): ReporterConsentProofVerifier {
  return createAppwriteReporterConsentVerifier(accountless, tables, schema);
}
/* v8 ignore stop */
