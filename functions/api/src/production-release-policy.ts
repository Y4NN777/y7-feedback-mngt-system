export interface ProductionReleaseSnapshot {
  readonly productionProjectId: string;
  readonly previewProjectId: string;
  readonly productionFunctionId: string;
  readonly previewFunctionId: string;
  readonly productionWebOrigin: string;
  readonly previewWebOrigin: string;
  readonly productionFunctionOrigin: string;
  readonly previewFunctionOrigin: string;
  readonly githubCallbackUrl: string;
  readonly gitlabCallbackUrl: string;
  readonly productionScannerOrigin: string;
  readonly previewScannerOrigin: string;
  readonly activeDeploymentReady: boolean;
  readonly rollbackDeploymentReady: boolean;
  readonly functionScopes: readonly string[];
  readonly missingFunctionVariables: readonly string[];
  readonly nonSecretFunctionVariables: readonly string[];
  readonly functionHealthReady: boolean;
  readonly scannerHealthReady: boolean;
  readonly scannerMatrixPassed: boolean;
  readonly scannerReleaseMatchesCandidate: boolean;
  readonly functionReleaseMatchesCandidate: boolean;
  readonly webReleaseMatchesCandidate: boolean;
  readonly providerBoundariesDenyUnsafeRequests: boolean;
  readonly webHealthReady: boolean;
  readonly webHeaders: {
    readonly contentSecurityPolicy: boolean;
    readonly referrerPolicy: boolean;
    readonly contentTypeOptions: boolean;
    readonly cacheRevalidation: boolean;
  };
  readonly functionRollbackPassed: boolean;
  readonly functionRollForwardPassed: boolean;
  readonly authoritativeDeletionPreserved: boolean;
}

const requiredFunctionScopes = [
  "files.read",
  "files.write",
  "rows.read",
  "rows.write",
  "teams.read",
  "users.read",
] as const;

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

export function assertProductionReleaseReady(snapshot: ProductionReleaseSnapshot): {
  readonly status: "ready";
  readonly checks: 27;
} {
  if (
    snapshot.productionProjectId === snapshot.previewProjectId ||
    snapshot.productionFunctionId === snapshot.previewFunctionId ||
    snapshot.productionWebOrigin === snapshot.previewWebOrigin ||
    snapshot.productionFunctionOrigin === snapshot.previewFunctionOrigin ||
    snapshot.productionScannerOrigin === snapshot.previewScannerOrigin
  ) {
    throw new Error("PRODUCTION_RELEASE_ENVIRONMENT_COLLISION");
  }
  if (
    snapshot.productionFunctionId !== "y7-feedback-api-production" ||
    snapshot.previewFunctionId !== "y7-feedback-api-preview" ||
    !sameSet(snapshot.functionScopes, requiredFunctionScopes) ||
    snapshot.missingFunctionVariables.length > 0 ||
    snapshot.nonSecretFunctionVariables.length > 0
  ) {
    throw new Error("PRODUCTION_RELEASE_FUNCTION_AUTHORITY_INVALID");
  }
  if (
    snapshot.githubCallbackUrl !==
      `${snapshot.productionFunctionOrigin}/providers/github/callback` ||
    snapshot.gitlabCallbackUrl !==
      `${snapshot.productionFunctionOrigin}/providers/gitlab/callback`
  ) {
    throw new Error("PRODUCTION_RELEASE_PROVIDER_CALLBACK_AUTHORITY_INVALID");
  }
  if (
    !snapshot.activeDeploymentReady ||
    !snapshot.rollbackDeploymentReady ||
    !snapshot.functionHealthReady ||
    !snapshot.scannerHealthReady ||
    !snapshot.scannerMatrixPassed ||
    !snapshot.scannerReleaseMatchesCandidate ||
    !snapshot.functionReleaseMatchesCandidate ||
    !snapshot.webReleaseMatchesCandidate ||
    !snapshot.providerBoundariesDenyUnsafeRequests ||
    !snapshot.webHealthReady ||
    !snapshot.webHeaders.contentSecurityPolicy ||
    !snapshot.webHeaders.referrerPolicy ||
    !snapshot.webHeaders.contentTypeOptions ||
    !snapshot.webHeaders.cacheRevalidation ||
    !snapshot.functionRollbackPassed ||
    !snapshot.functionRollForwardPassed ||
    !snapshot.authoritativeDeletionPreserved
  ) {
    throw new Error("PRODUCTION_RELEASE_READINESS_FAILED");
  }
  return { status: "ready", checks: 27 };
}
