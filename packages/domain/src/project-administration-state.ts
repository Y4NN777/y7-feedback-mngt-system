import type {
  ProjectAdministrationCommand,
  ProjectAdministrationConfiguration,
} from "./project-administration.js";

export class ProjectAdministrationStateError extends Error {
  readonly code:
    | "ERR-ADMIN-MAINTAINER-INELIGIBLE"
    | "ERR-ADMIN-NO-OP"
    | "ERR-ADMIN-SCOPE-DENIED"
    | "ERR-ADMIN-STATE-INVALID";

  constructor(code: ProjectAdministrationStateError["code"]) {
    super(code);
    this.name = "ProjectAdministrationStateError";
    this.code = code;
  }
}

export interface ProjectAdministrationState extends ProjectAdministrationConfiguration {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly slug: string;
  readonly active: boolean;
}

export interface MaintainerAssignmentState {
  readonly eligible: boolean;
  readonly active: boolean;
}

export type ProjectAdministrationMutation =
  | {
      readonly kind: "configure_project";
      readonly projectPatch: ProjectAdministrationConfiguration;
    }
  | {
      readonly kind: "rename_project";
      readonly previousSlug: string;
      readonly slug: string;
    }
  | { readonly kind: "set_project_activation"; readonly active: boolean }
  | {
      readonly kind: "assign_maintainer" | "remove_maintainer";
      readonly maintainerId: string;
      readonly active: boolean;
    };

function sameConfiguration(
  command: ProjectAdministrationConfiguration,
  state: ProjectAdministrationState,
): boolean {
  return (
    JSON.stringify(command.enabledTypes) === JSON.stringify(state.enabledTypes) &&
    JSON.stringify(command.contextDeclarations) ===
      JSON.stringify(state.contextDeclarations) &&
    command.reporterPurpose.fr === state.reporterPurpose.fr &&
    command.reporterPurpose.en === state.reporterPurpose.en
  );
}

function noOp(): never {
  throw new ProjectAdministrationStateError("ERR-ADMIN-NO-OP");
}

export function planProjectAdministrationMutation(
  command: ProjectAdministrationCommand,
  state: ProjectAdministrationState,
  assignment?: MaintainerAssignmentState,
): ProjectAdministrationMutation {
  if (
    command.projectId !== state.projectId ||
    command.workspaceId !== state.workspaceId
  ) {
    throw new ProjectAdministrationStateError("ERR-ADMIN-SCOPE-DENIED");
  }

  switch (command.kind) {
    case "create_project":
      throw new ProjectAdministrationStateError("ERR-ADMIN-STATE-INVALID");
    case "configure_project":
      if (sameConfiguration(command, state)) return noOp();
      return {
        kind: command.kind,
        projectPatch: {
          enabledTypes: command.enabledTypes,
          contextDeclarations: command.contextDeclarations,
          reporterPurpose: command.reporterPurpose,
        },
      };
    case "rename_project":
      return command.slug === state.slug
        ? noOp()
        : {
            kind: command.kind,
            previousSlug: state.slug,
            slug: command.slug,
          };
    case "set_project_activation":
      return command.active === state.active
        ? noOp()
        : { kind: command.kind, active: command.active };
    case "assign_maintainer":
    case "remove_maintainer": {
      if (assignment === undefined || !assignment.eligible) {
        throw new ProjectAdministrationStateError("ERR-ADMIN-MAINTAINER-INELIGIBLE");
      }
      const active = command.kind === "assign_maintainer";
      return assignment.active === active
        ? noOp()
        : {
            kind: command.kind,
            maintainerId: command.maintainerId,
            active,
          };
    }
  }
}
