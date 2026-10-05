import type { ActorAccess, Project, ProjectCapability } from "@y7-feedback/domain";

export type AppwritePrincipalVerification =
  | { readonly status: "verified"; readonly principalId: string }
  | { readonly status: "denied" }
  | { readonly status: "retryable" };

export interface AppwritePrincipalVerifier {
  verify(jwt: string): Promise<AppwritePrincipalVerification>;
}

export type WorkspaceCapabilityScopeOutcome =
  | {
      readonly status: "authorized";
      readonly actor: ActorAccess;
      readonly project: Project;
    }
  | { readonly status: "denied" | "retryable" };

export interface WorkspaceCapabilityScopeResolver {
  resolve(input: {
    readonly principalId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly capability: ProjectCapability;
  }): Promise<WorkspaceCapabilityScopeOutcome>;
}
