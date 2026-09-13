export function stableProbeFailureCode(output: string): string {
  for (const line of output.trim().split("\n").reverse()) {
    try {
      const parsed = JSON.parse(line) as Readonly<Record<string, unknown>>;
      const value =
        typeof parsed.code === "string"
          ? parsed.code
          : typeof parsed.error === "string"
            ? parsed.error
            : undefined;
      const code = value?.match(/^[A-Z][A-Z0-9_]{2,80}/u)?.[0];
      if (code !== undefined) return code;
    } catch {
      // Ignore non-JSON diagnostics and continue toward the stable final error.
    }
  }
  return "UNKNOWN";
}
