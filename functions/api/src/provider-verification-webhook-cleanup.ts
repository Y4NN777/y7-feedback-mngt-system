type Provider = "github" | "gitlab";

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hookId(value: unknown): string | undefined {
  if (!object(value)) return undefined;
  const id = value.id;
  return (typeof id === "number" && Number.isSafeInteger(id) && id > 0) ||
    (typeof id === "string" && /^[1-9][0-9]*$/u.test(id))
    ? String(id)
    : undefined;
}

async function request(
  fetcher: Fetcher,
  token: string,
  provider: Provider,
  input: URL,
  method: "GET" | "DELETE",
): Promise<Response> {
  const response = await fetcher(input.toString(), {
    method,
    cache: "no-store",
    credentials: "omit",
    headers: {
      accept:
        provider === "github" ? "application/vnd.github+json" : "application/json",
      authorization: `Bearer ${token}`,
      ...(provider === "github" ? { "x-github-api-version": "2022-11-28" } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("PROVIDER_VERIFICATION_WEBHOOK_CLEANUP_FAILED");
  return response;
}

export async function removeProviderVerificationWebhooks(input: {
  readonly provider: Provider;
  readonly token: string;
  readonly repository: {
    readonly id: string;
    readonly owner: string;
    readonly name: string;
  };
  readonly callbackUrl: string;
  readonly gitlabOrigin: string;
  readonly fetcher?: Fetcher;
}): Promise<number> {
  const fetcher = input.fetcher ?? globalThis.fetch;
  const base =
    input.provider === "github"
      ? new URL(
          `repos/${encodeURIComponent(input.repository.owner)}/${encodeURIComponent(input.repository.name)}/hooks/`,
          "https://api.github.com/",
        )
      : new URL(
          `api/v4/projects/${encodeURIComponent(input.repository.id)}/hooks/`,
          input.gitlabOrigin,
        );
  const listed = await request(fetcher, input.token, input.provider, base, "GET");
  const hooks: unknown = await listed.json();
  if (!Array.isArray(hooks))
    throw new Error("PROVIDER_VERIFICATION_WEBHOOK_CLEANUP_FAILED");
  const matches = hooks.flatMap((hook) => {
    const id = hookId(hook);
    const url =
      object(hook) && input.provider === "github" && object(hook.config)
        ? hook.config.url
        : object(hook)
          ? hook.url
          : undefined;
    return id !== undefined && url === input.callbackUrl ? [id] : [];
  });
  await Promise.all(
    matches.map((id) =>
      request(fetcher, input.token, input.provider, new URL(id, base), "DELETE"),
    ),
  );
  return matches.length;
}
