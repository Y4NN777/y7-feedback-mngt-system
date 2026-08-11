import type { Project } from "./policy";

export type Responsibility =
  "workspace_owner" | "project_maintainer" | "platform_operator" | "platform_owner";

export type ProjectCapability =
  | "feedback.read"
  | "feedback.write"
  | "feedback.search"
  | "feedback.aggregate"
  | "attachment.read"
  | "notification.read"
  | "realtime.subscribe"
  | "project.manage";

export interface ActorAccess {
  readonly principalId: string;
  readonly responsibility: Responsibility;
  readonly workspaceIds: readonly string[];
  readonly projectIds: readonly string[];
}

export interface AuthorizationPolicy {
  can(actor: ActorAccess, capability: ProjectCapability, project: Project): boolean;
}

const maintainerCapabilities: ReadonlySet<ProjectCapability> = new Set([
  "feedback.read",
  "feedback.write",
  "feedback.search",
  "feedback.aggregate",
  "attachment.read",
  "notification.read",
  "realtime.subscribe",
]);

export function createAuthorizationPolicy(): AuthorizationPolicy {
  return {
    can(actor, capability, project) {
      const belongsToWorkspace = actor.workspaceIds.includes(project.workspaceId);
      if (!belongsToWorkspace) {
        return false;
      }
      if (actor.responsibility === "workspace_owner") {
        return true;
      }
      if (actor.responsibility !== "project_maintainer") {
        return false;
      }
      return (
        actor.projectIds.includes(project.id) && maintainerCapabilities.has(capability)
      );
    },
  };
}
