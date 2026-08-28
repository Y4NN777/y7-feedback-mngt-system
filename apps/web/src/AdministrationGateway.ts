export type AdministrationOutcome =
  | { readonly status: "ok"; readonly project: Readonly<Record<string, unknown>> }
  | {
      readonly status:
        "invalid" | "denied" | "conflict" | "slug_reserved" | "retryable";
    };

export interface AdministrationGateway {
  execute(command: Readonly<Record<string, unknown>>): Promise<AdministrationOutcome>;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const outcomes = {
  "ERR-ADMIN-COMMAND-INVALID": "invalid",
  "ERR-ADMIN-DENIED": "denied",
  "ERR-ADMIN-IDEMPOTENCY-CONFLICT": "conflict",
  "ERR-ADMIN-SLUG-RESERVED": "slug_reserved",
  "ERR-ADMIN-RETRYABLE": "retryable",
} as const;

export function createHttpAdministrationGateway(
  endpoint: string,
  getJwt: () => Promise<string>,
  fetcher: Fetcher = fetch,
): AdministrationGateway {
  const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  return {
    async execute(command) {
      const workspaceId = command.workspaceId;
      const projectId = command.projectId;
      if (typeof workspaceId !== "string" || typeof projectId !== "string") {
        return { status: "invalid" };
      }
      let jwt: string;
      try {
        jwt = await getJwt();
      } catch {
        return { status: "denied" };
      }
      const creation = command.kind === "create_project";
      const path = creation
        ? `/v1/workspaces/${encodeURIComponent(workspaceId)}/projects`
        : `/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/commands`;
      try {
        const response = await fetcher(`${base}${path}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${jwt}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(command),
        });
        const body: unknown = await response.json();
        if (response.ok && object(body) && object(body.project)) {
          return { status: "ok", project: body.project };
        }
        if (object(body) && typeof body.error === "string" && body.error in outcomes) {
          return { status: outcomes[body.error as keyof typeof outcomes] };
        }
      } catch {
        // Network and malformed responses share one stable retryable outcome.
      }
      return { status: "retryable" };
    },
  };
}
