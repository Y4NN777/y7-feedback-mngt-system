export type DirectAccessSurface =
  | "projects"
  | "feedback"
  | "notifications"
  | "source_connections"
  | "provider_grants"
  | "files";

export interface DirectAccessIsolationPort {
  countVisible(jwt: string, surface: DirectAccessSurface): Promise<number>;
  readSentinel(
    jwt: string,
    surface: DirectAccessSurface,
  ): Promise<"allowed" | "denied">;
  createSyntheticSource(jwt: string): Promise<"allowed" | "denied">;
  updateSyntheticGrant(jwt: string): Promise<"allowed" | "denied">;
  deleteSyntheticGrant(jwt: string): Promise<"allowed" | "denied">;
  observeRealtime(jwt: string): Promise<"isolated" | "leaked">;
}

export interface DirectAccessIsolationResult {
  readonly principalsChecked: number;
  readonly surfacesChecked: number;
  readonly listIsolation: true;
  readonly sentinelIsolation: true;
  readonly mutationIsolation: true;
  readonly realtimeIsolation: true;
}

export async function runDirectAccessIsolationMatrix(
  port: DirectAccessIsolationPort,
  principalJwts: readonly string[],
  surfaces: readonly DirectAccessSurface[],
): Promise<DirectAccessIsolationResult> {
  if (
    principalJwts.length === 0 ||
    surfaces.length === 0 ||
    principalJwts.some((jwt) => !jwt) ||
    new Set(surfaces).size !== surfaces.length
  ) {
    throw new Error("APPWRITE_DIRECT_ACCESS_MATRIX_INVALID");
  }

  try {
    for (const jwt of principalJwts) {
      for (const surface of surfaces) {
        if ((await port.countVisible(jwt, surface)) !== 0) {
          throw new Error("APPWRITE_DIRECT_ACCESS_ISOLATION_FAILED");
        }
        if ((await port.readSentinel(jwt, surface)) !== "denied") {
          throw new Error("APPWRITE_DIRECT_ACCESS_ISOLATION_FAILED");
        }
      }
      if ((await port.createSyntheticSource(jwt)) !== "denied") {
        throw new Error("APPWRITE_DIRECT_ACCESS_ISOLATION_FAILED");
      }
      if ((await port.updateSyntheticGrant(jwt)) !== "denied") {
        throw new Error("APPWRITE_DIRECT_ACCESS_ISOLATION_FAILED");
      }
      if ((await port.deleteSyntheticGrant(jwt)) !== "denied") {
        throw new Error("APPWRITE_DIRECT_ACCESS_ISOLATION_FAILED");
      }
      if ((await port.observeRealtime(jwt)) !== "isolated") {
        throw new Error("APPWRITE_DIRECT_ACCESS_ISOLATION_FAILED");
      }
    }
  } catch {
    throw new Error("APPWRITE_DIRECT_ACCESS_ISOLATION_FAILED");
  }

  return {
    principalsChecked: principalJwts.length,
    surfacesChecked: surfaces.length,
    listIsolation: true,
    sentinelIsolation: true,
    mutationIsolation: true,
    realtimeIsolation: true,
  };
}
