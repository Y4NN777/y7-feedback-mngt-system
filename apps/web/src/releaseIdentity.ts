const releaseIdentity = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;

export function parseWebReleaseIdentity(value: string | undefined): string {
  const release = value?.trim() || "local";
  if (!releaseIdentity.test(release)) {
    throw new Error("WEB_RELEASE_IDENTITY_INVALID");
  }
  return release;
}
