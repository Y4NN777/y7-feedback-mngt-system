const nondisclosingDenialStatuses = new Set([400, 401, 403, 404]);

export async function isNondisclosingProviderDenial(
  response: Response,
): Promise<boolean> {
  if (!nondisclosingDenialStatuses.has(response.status)) return false;
  const body = (await response.json()) as unknown;
  return (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string" &&
    /^ERR-[A-Z0-9-]+$/u.test(body.error)
  );
}
