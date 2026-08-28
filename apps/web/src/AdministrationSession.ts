import { Account, Client } from "appwrite";

export interface AdministrationSession {
  createJwt(): Promise<string>;
  signIn(email: string, password: string): Promise<"authenticated" | "denied">;
  signOut(): Promise<void>;
}

interface AccountPort {
  createEmailPasswordSession(input: {
    readonly email: string;
    readonly password: string;
  }): Promise<unknown>;
  createJWT(): Promise<{ readonly jwt: string }>;
  deleteSession(input: { readonly sessionId: "current" }): Promise<unknown>;
}

export function createAdministrationSession(
  account: AccountPort,
): AdministrationSession {
  return {
    async createJwt() {
      const result = await account.createJWT();
      if (!result.jwt || result.jwt.length > 4096) throw new Error("SESSION_DENIED");
      return result.jwt;
    },
    async signIn(email, password) {
      if (!email.trim() || !password) return "denied";
      try {
        await account.createEmailPasswordSession({ email, password });
        return "authenticated";
      } catch {
        return "denied";
      }
    },
    async signOut() {
      await account.deleteSession({ sessionId: "current" });
    },
  };
}

export function createAppwriteAdministrationSession(
  endpoint: string,
  projectId: string,
): AdministrationSession {
  const client = new Client().setEndpoint(endpoint).setProject(projectId);
  return createAdministrationSession(new Account(client));
}
