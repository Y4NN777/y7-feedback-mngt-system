export interface HttpRouteRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly query: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
  readonly bodyBinary?: Uint8Array;
}

export interface HttpRouteResponse {
  readonly statusCode: number;
  readonly body?: unknown;
  readonly binary?: {
    readonly bytes: Uint8Array;
    readonly displayName: string;
    readonly mediaType: string;
  };
}

export type HttpOperation =
  | "provider_webhook"
  | "provider_maintenance"
  | "provider_event_inbox"
  | "provider_issue_outbox"
  | "source_connection"
  | "project_administration"
  | "platform_access"
  | "conversation_lifecycle"
  | "workbench"
  | "external_issue"
  | "intelligence"
  | "privacy"
  | "public_api";

export interface HttpRoute {
  readonly operation: HttpOperation;
  readonly handle: (
    request: HttpRouteRequest,
  ) => Promise<HttpRouteResponse | null | undefined>;
}

export interface RoutedHttpResponse {
  readonly operation: HttpOperation;
  readonly response: HttpRouteResponse;
}

export async function dispatchHttpRouteRegistry(
  routes: readonly HttpRoute[],
  request: HttpRouteRequest,
): Promise<RoutedHttpResponse | undefined> {
  for (const route of routes) {
    const response = await route.handle(request);
    if (response !== null && response !== undefined) {
      return { operation: route.operation, response };
    }
  }
  return undefined;
}

export function emitHttpRouteResponse(
  responseWriter: {
    readonly binary?: (
      bytes: Uint8Array,
      statusCode?: number,
      headers?: Readonly<Record<string, string>>,
    ) => unknown;
    readonly json: (
      body: unknown,
      statusCode?: number,
      headers?: Readonly<Record<string, string>>,
    ) => unknown;
  },
  response: HttpRouteResponse,
  headers: Readonly<Record<string, string>>,
): unknown {
  if (response.binary === undefined) {
    return responseWriter.json(response.body, response.statusCode, headers);
  }
  if (responseWriter.binary === undefined) {
    return responseWriter.json({ error: "ERR-ATTACHMENT-UNAVAILABLE" }, 503, headers);
  }
  return responseWriter.binary(
    Buffer.from(response.binary.bytes),
    response.statusCode,
    {
      ...headers,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(response.binary.displayName)}`,
      "content-length": String(response.binary.bytes.byteLength),
      "content-type": response.binary.mediaType,
    },
  );
}
