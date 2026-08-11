export class DomainPolicyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "DomainPolicyError";
    this.code = code;
  }
}

export interface WorkspaceScoped {
  readonly workspaceId: string;
}

export interface Project extends WorkspaceScoped {
  readonly id: string;
  readonly active: boolean;
}

export function assertSameWorkspace(
  owner: WorkspaceScoped,
  candidate: WorkspaceScoped,
): void {
  if (owner.workspaceId !== candidate.workspaceId) {
    throw new DomainPolicyError("SCOPE_DENIED");
  }
}

export function assertOwnershipUnchanged(
  existing: { readonly workspaceId: string; readonly projectId: string },
  update: { readonly workspaceId: string; readonly projectId: string },
): void {
  if (
    existing.workspaceId !== update.workspaceId ||
    existing.projectId !== update.projectId
  ) {
    throw new DomainPolicyError("OWNERSHIP_IMMUTABLE");
  }
}
