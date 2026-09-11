const commitSha = /^[0-9a-f]{40}$/u;

export function parseScannerRelease(value: string | undefined): string {
  const release = value?.trim() ?? "";
  if (!commitSha.test(release)) {
    throw new Error("ANTIVIRUS_SERVICE_CONFIG_INVALID");
  }
  return release;
}
