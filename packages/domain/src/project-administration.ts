import {
  validateProjectFeedbackConfig,
  type ContextDeclaration,
  type FeedbackType,
} from "./feedback.js";

export class ProjectAdministrationError extends Error {
  readonly code: "ERR-ADMIN-COMMAND-INVALID";

  constructor(code: "ERR-ADMIN-COMMAND-INVALID") {
    super(code);
    this.name = "ProjectAdministrationError";
    this.code = code;
  }
}

interface ProjectAdministrationIdentity {
  readonly operationId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

export interface ProjectAdministrationConfiguration {
  readonly enabledTypes: readonly FeedbackType[];
  readonly contextDeclarations: readonly ContextDeclaration[];
  readonly reporterPurpose: {
    readonly fr: string;
    readonly en: string;
  };
}

export type ProjectAdministrationCommand =
  | (ProjectAdministrationIdentity &
      ProjectAdministrationConfiguration & {
        readonly kind: "create_project";
        readonly slug: string;
      })
  | (ProjectAdministrationIdentity &
      ProjectAdministrationConfiguration & {
        readonly kind: "configure_project";
      })
  | (ProjectAdministrationIdentity & {
      readonly kind: "rename_project";
      readonly slug: string;
    })
  | (ProjectAdministrationIdentity & {
      readonly kind: "set_project_activation";
      readonly active: boolean;
    })
  | (ProjectAdministrationIdentity & {
      readonly kind: "assign_maintainer" | "remove_maintainer";
      readonly maintainerId: string;
    });

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const validSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const reservedSlugs = new Set(["api", "assets", "manage", "retrieve"]);
const executableText = /<\s*script|javascript\s*:|\b(?:function|eval)\s*\(/iu;
const feedbackTypes = new Set<unknown>(["bug", "suggestion", "review"]);
const contextTypes = new Set<unknown>(["string", "number", "boolean"]);

function invalid(): never {
  throw new ProjectAdministrationError("ERR-ADMIN-COMMAND-INVALID");
}

function object(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : invalid();
}

function identifier(value: unknown): string {
  return typeof value === "string" && appwriteId.test(value) ? value : invalid();
}

function slug(value: unknown): string {
  return typeof value === "string" &&
    validSlug.test(value) &&
    value.length <= 63 &&
    !reservedSlugs.has(value)
    ? value
    : invalid();
}

function purpose(value: unknown): string {
  if (typeof value !== "string") return invalid();
  const normalized = value.trim();
  return normalized.length > 0 &&
    normalized.length <= 300 &&
    !executableText.test(normalized)
    ? normalized
    : invalid();
}

function configuration(
  value: Readonly<Record<string, unknown>>,
  projectId: string,
  workspaceId: string,
): ProjectAdministrationConfiguration {
  if (!Array.isArray(value.enabledTypes) || !Array.isArray(value.contextDeclarations)) {
    return invalid();
  }
  const enabledTypes = value.enabledTypes.every((item) => feedbackTypes.has(item))
    ? (value.enabledTypes as readonly FeedbackType[])
    : invalid();
  const contextDeclarations = value.contextDeclarations.map((candidate) => {
    const declaration = object(candidate);
    if (
      typeof declaration.name !== "string" ||
      !contextTypes.has(declaration.type) ||
      typeof declaration.purpose !== "string"
    ) {
      return invalid();
    }
    return {
      name: declaration.name,
      type: declaration.type as ContextDeclaration["type"],
      purpose: purpose(declaration.purpose),
    };
  });
  const rawPurpose = object(value.reporterPurpose);
  const reporterPurpose = {
    fr: purpose(rawPurpose.fr),
    en: purpose(rawPurpose.en),
  };
  try {
    validateProjectFeedbackConfig({
      projectId,
      workspaceId,
      active: true,
      enabledTypes,
      contextDeclarations,
    });
  } catch {
    return invalid();
  }
  return { enabledTypes, contextDeclarations, reporterPurpose };
}

export function validateProjectAdministrationCommand(
  input: unknown,
): ProjectAdministrationCommand {
  const value = object(input);
  const operationId = identifier(value.operationId);
  const workspaceId = identifier(value.workspaceId);
  const projectId = identifier(value.projectId);
  const identity = { operationId, workspaceId, projectId };

  switch (value.kind) {
    case "create_project":
      return {
        kind: value.kind,
        ...identity,
        slug: slug(value.slug),
        ...configuration(value, projectId, workspaceId),
      };
    case "configure_project":
      return {
        kind: value.kind,
        ...identity,
        ...configuration(value, projectId, workspaceId),
      };
    case "rename_project":
      return { kind: value.kind, ...identity, slug: slug(value.slug) };
    case "set_project_activation":
      return typeof value.active === "boolean"
        ? { kind: value.kind, ...identity, active: value.active }
        : invalid();
    case "assign_maintainer":
    case "remove_maintainer":
      return {
        kind: value.kind,
        ...identity,
        maintainerId: identifier(value.maintainerId),
      };
    default:
      return invalid();
  }
}
