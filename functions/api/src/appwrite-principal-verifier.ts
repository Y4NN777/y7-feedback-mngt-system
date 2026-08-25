import { Account, Client } from "node-appwrite";

import type {
  AppwritePrincipalVerification,
  AppwritePrincipalVerifier,
} from "./workspace-attachment-download.js";

export interface AppwriteAccountPort {
  get(): Promise<unknown>;
}

export type AppwriteAccountFactory = (jwt: string) => AppwriteAccountPort;

export interface AppwritePrincipalVerifierConfig {
  readonly endpoint: string;
  readonly projectId: string;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function authenticationFailure(error: unknown): boolean {
  return isObject(error) && (error.code === 401 || error.code === 403);
}

export function createAppwritePrincipalVerifier(
  accountForJwt: AppwriteAccountFactory,
): AppwritePrincipalVerifier {
  return {
    async verify(jwt): Promise<AppwritePrincipalVerification> {
      if (jwt.length > 4_096 || !jwtPattern.test(jwt)) {
        return { status: "denied" };
      }
      try {
        const account = await accountForJwt(jwt).get();
        if (
          !isObject(account) ||
          typeof account.$id !== "string" ||
          !appwriteId.test(account.$id)
        ) {
          return { status: "retryable" };
        }
        return { status: "verified", principalId: account.$id };
      } catch (error: unknown) {
        return authenticationFailure(error)
          ? { status: "denied" }
          : { status: "retryable" };
      }
    },
  };
}

function validateConfig(config: AppwritePrincipalVerifierConfig): void {
  let endpoint: URL;
  try {
    endpoint = new URL(config.endpoint);
  } catch {
    throw new Error("APPWRITE_PRINCIPAL_CONFIG_INVALID");
  }
  if (
    (endpoint.protocol !== "https:" && endpoint.hostname !== "127.0.0.1") ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    !appwriteId.test(config.projectId)
  ) {
    throw new Error("APPWRITE_PRINCIPAL_CONFIG_INVALID");
  }
}

export function createNodeAppwritePrincipalVerifier(
  config: AppwritePrincipalVerifierConfig,
): AppwritePrincipalVerifier {
  validateConfig(config);
  return createAppwritePrincipalVerifier((jwt) => {
    const client = new Client()
      .setEndpoint(config.endpoint)
      .setProject(config.projectId)
      .setJWT(jwt);
    return new Account(client);
  });
}
