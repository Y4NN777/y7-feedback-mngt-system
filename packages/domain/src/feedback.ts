import type { ReporterAttribution } from "./reporter";

export type FeedbackType = "bug" | "suggestion" | "review";
export type ContextType = "string" | "number" | "boolean";

export type FeedbackSource =
  | {
      readonly type: "bug";
      readonly problem: string;
      readonly expectedBehavior?: string;
      readonly observedBehavior?: string;
      readonly reproductionSteps?: string;
    }
  | {
      readonly type: "suggestion";
      readonly proposal: string;
      readonly rationale: string;
      readonly usageContext?: string;
    }
  | {
      readonly type: "review";
      readonly experience: string;
      readonly appreciation: string;
    };

export interface ContextDeclaration {
  readonly name: string;
  readonly type: ContextType;
  readonly purpose: string;
}

export interface ProjectFeedbackConfig {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly active: boolean;
  readonly enabledTypes: readonly FeedbackType[];
  readonly contextDeclarations: readonly ContextDeclaration[];
}

export interface ContextInput {
  readonly name: string;
  readonly value: string | number | boolean;
  readonly source: "public" | "client_assertion" | "system_observed";
  readonly assertionVerified?: boolean;
}

export interface FeedbackDraft {
  readonly type: FeedbackType;
  readonly source: FeedbackSource;
  readonly reporter: ReporterAttribution;
  readonly context: readonly ContextInput[];
  readonly attachmentNames: readonly string[];
}

export interface ValidatedContext {
  readonly name: string;
  readonly value: string | number | boolean;
  readonly purpose: string;
  readonly source: ContextInput["source"];
  readonly trust: "unverified" | "verified";
}

export interface ValidatedFeedbackDraft {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly type: FeedbackType;
  readonly originalSource: FeedbackSource;
  readonly reporter: ReporterAttribution;
  readonly context: readonly ValidatedContext[];
  readonly attachmentNames: readonly string[];
  readonly derivedClassification: null;
}

export class FeedbackPolicyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "FeedbackPolicyError";
    this.code = code;
  }
}

const validName = /^[A-Za-z][A-Za-z0-9]{0,63}$/u;
const executableContext = /<\s*script|javascript\s*:|\b(?:function|eval)\s*\(/iu;

function requiredSource(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 5_000) {
    throw new FeedbackPolicyError("SOURCE_INVALID");
  }
  return normalized;
}

function optionalSource(value: string | undefined): string | undefined {
  return value === undefined ? undefined : requiredSource(value);
}

function validateSource(source: FeedbackSource): FeedbackSource {
  if (source.type === "bug") {
    const expectedBehavior = optionalSource(source.expectedBehavior);
    const observedBehavior = optionalSource(source.observedBehavior);
    const reproductionSteps = optionalSource(source.reproductionSteps);
    return {
      type: "bug",
      problem: requiredSource(source.problem),
      ...(expectedBehavior === undefined ? {} : { expectedBehavior }),
      ...(observedBehavior === undefined ? {} : { observedBehavior }),
      ...(reproductionSteps === undefined ? {} : { reproductionSteps }),
    };
  }
  if (source.type === "suggestion") {
    const usageContext = optionalSource(source.usageContext);
    return {
      type: "suggestion",
      proposal: requiredSource(source.proposal),
      rationale: requiredSource(source.rationale),
      ...(usageContext === undefined ? {} : { usageContext }),
    };
  }
  return {
    type: "review",
    experience: requiredSource(source.experience),
    appreciation: requiredSource(source.appreciation),
  };
}

export function validateProjectFeedbackConfig(
  config: ProjectFeedbackConfig,
): ProjectFeedbackConfig {
  const rawTypes: readonly unknown[] = config.enabledTypes;
  const types = new Set(config.enabledTypes);
  const declarations = new Set(config.contextDeclarations.map((item) => item.name));
  if (
    (config.active && types.size === 0) ||
    types.size !== config.enabledTypes.length ||
    rawTypes.some(
      (type) => type !== "bug" && type !== "suggestion" && type !== "review",
    ) ||
    config.contextDeclarations.length > 20 ||
    declarations.size !== config.contextDeclarations.length ||
    config.contextDeclarations.some(
      (item) =>
        !validName.test(item.name) ||
        !item.purpose.trim() ||
        item.purpose.length > 300 ||
        !["string", "number", "boolean"].includes(item.type),
    )
  ) {
    throw new FeedbackPolicyError("PROJECT_TYPE_CONFIGURATION_INVALID");
  }
  return config;
}

function validateContext(
  config: ProjectFeedbackConfig,
  inputs: readonly ContextInput[],
): readonly ValidatedContext[] {
  if (
    inputs.length > 20 ||
    new Set(inputs.map((item) => item.name)).size !== inputs.length
  ) {
    throw new FeedbackPolicyError("CONTEXT_INVALID");
  }
  const declarations = new Map(
    config.contextDeclarations.map((item) => [item.name, item] as const),
  );
  return inputs.map((input) => {
    const declaration = declarations.get(input.name);
    const typeMatches = declaration && typeof input.value === declaration.type;
    const stringValid =
      typeof input.value !== "string" ||
      (input.value.length <= 500 && !executableContext.test(input.value));
    const numberValid = typeof input.value !== "number" || Number.isFinite(input.value);
    if (!declaration || !typeMatches || !stringValid || !numberValid) {
      throw new FeedbackPolicyError("CONTEXT_INVALID");
    }
    return {
      name: input.name,
      value: input.value,
      purpose: declaration.purpose,
      source: input.source,
      trust:
        input.source === "public" ||
        (input.source === "client_assertion" && input.assertionVerified !== true)
          ? "unverified"
          : "verified",
    };
  });
}

export function validateFeedbackDraft(
  rawConfig: ProjectFeedbackConfig,
  draft: FeedbackDraft,
): ValidatedFeedbackDraft {
  const config = validateProjectFeedbackConfig(rawConfig);
  if (!config.active || !config.enabledTypes.includes(draft.type)) {
    throw new FeedbackPolicyError("FEEDBACK_TYPE_DISABLED");
  }
  if (draft.source.type !== draft.type) {
    throw new FeedbackPolicyError("SOURCE_INVALID");
  }
  if (
    draft.attachmentNames.length > 5 ||
    draft.attachmentNames.some((name) => !name.trim() || name.length > 255)
  ) {
    throw new FeedbackPolicyError("ATTACHMENT_MANIFEST_INVALID");
  }

  return {
    projectId: config.projectId,
    workspaceId: config.workspaceId,
    type: draft.type,
    originalSource: validateSource(draft.source),
    reporter: draft.reporter,
    context: validateContext(config, draft.context),
    attachmentNames: [...draft.attachmentNames],
    derivedClassification: null,
  };
}
