export async function probeUrl(
  url: string,
  fetcher: typeof fetch = fetch,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetcher(url, {
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return true;
      if (response.status < 500 || attempt === 3) return false;
    } catch {
      if (attempt === 3) return false;
    }
    await wait(attempt * 500);
  }
  /* v8 ignore next -- every third-attempt branch returns above. */
  return false;
}
