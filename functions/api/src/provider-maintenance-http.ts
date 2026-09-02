import { timingSafeEqual } from "node:crypto";

import type { ProviderMaintenance } from "./provider-maintenance.js";

export interface ProviderMaintenanceHttp {
  handle(input: {
    readonly method: string;
    readonly path: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
    readonly body: unknown;
  }): Promise<
    | { readonly statusCode: number; readonly body: Readonly<Record<string, unknown>> }
    | undefined
  >;
}

function authorized(header: string | undefined, secret: string): boolean {
  if (header === undefined || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createProviderMaintenanceHttp(
  maintenance: ProviderMaintenance,
  triggerSecret: string,
): ProviderMaintenanceHttp {
  if (triggerSecret.length < 32 || triggerSecret.length > 500) {
    throw new Error("PROVIDER_MAINTENANCE_HTTP_CONFIG_INVALID");
  }
  return {
    async handle(input) {
      if (input.path !== "/operational/provider-maintenance") return undefined;
      if (
        input.method !== "POST" ||
        !authorized(input.headers.authorization, triggerSecret) ||
        input.headers["x-appwrite-user-id"] !== undefined ||
        typeof input.body !== "object" ||
        input.body === null ||
        Array.isArray(input.body) ||
        Object.keys(input.body).length !== 0
      ) {
        return {
          statusCode: 404,
          body: { error: "ERR-PROVIDER-MAINTENANCE-DENIED" },
        };
      }
      try {
        return { statusCode: 200, body: await maintenance.runOnce() };
      } catch {
        return {
          statusCode: 503,
          body: { error: "ERR-PROVIDER-MAINTENANCE-RETRYABLE" },
        };
      }
    },
  };
}
