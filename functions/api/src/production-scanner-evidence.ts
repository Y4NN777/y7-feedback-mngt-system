const commitSha = /^[0-9a-f]{40}$/u;

export function assertProductionScannerRelease(
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
    throw new Error("PRODUCTION_SCANNER_RELEASE_MISMATCH");
  }
  return true;
}
