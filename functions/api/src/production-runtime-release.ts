const commitSha = /^[0-9a-f]{40}$/u;

export function assertProductionFunctionRelease(
  body: unknown,
  candidateRelease: string,
): true {
  if (
    !commitSha.test(candidateRelease) ||
    typeof body !== "object" ||
    body === null ||
    !("status" in body) ||
    body.status !== "ok" ||
    !("release" in body) ||
    body.release !== candidateRelease
  ) {
    throw new Error("PRODUCTION_FUNCTION_RELEASE_MISMATCH");
  }
  return true;
}

export function assertProductionWebRelease(
  html: string,
  candidateRelease: string,
): true {
  if (
    !commitSha.test(candidateRelease) ||
    !html.includes(`<meta name="y7-release" content="${candidateRelease}" />`)
  ) {
    throw new Error("PRODUCTION_WEB_RELEASE_MISMATCH");
  }
  return true;
}
