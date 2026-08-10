export interface FunctionRequest {
  readonly method: string;
  readonly path: string;
}

export interface FunctionResponse {
  json(
    body: unknown,
    statusCode?: number,
    headers?: Readonly<Record<string, string>>,
  ): unknown;
}

export interface FunctionContext {
  readonly req: FunctionRequest;
  readonly res: FunctionResponse;
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
}

const noStore = { "cache-control": "no-store" } as const;

export function routeRequest({ req, res }: FunctionContext): unknown {
  if (req.method === "GET" && req.path === "/health") {
    return res.json({ status: "ok" }, 200, noStore);
  }

  return res.json({ error: "not_found" }, 404, noStore);
}
