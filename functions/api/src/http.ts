import { randomUUID } from "node:crypto";

import { serializeOperationalEvent } from "./observability.js";
import type { ConversationLifecycleHttp } from "./conversation-lifecycle-http.js";
import type { ExternalIssueHttp } from "./external-issue-http.js";
import type { IntelligenceHttp } from "./intelligence-http.js";
import type { PrivacyHttp } from "./privacy-http.js";
import type { PublicApi } from "./public-api.js";
import type { ProjectAdministrationHttp } from "./project-administration-http.js";
import type { ProviderIssueOutboxHttp } from "./provider-issue-outbox-http.js";
import type { ProviderEventInboxHttp } from "./provider-event-inbox-http.js";
import type { ProviderMaintenance } from "./provider-maintenance.js";
import type { ProviderWebhookHttpResponse } from "./provider-webhook-http.js";
import type { SourceConnectionHttp } from "./source-connection-http.js";
import type { WorkbenchHttp } from "./workbench-http.js";

export interface FunctionRequest {
  readonly method: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly bodyJson?: unknown;
  readonly bodyBinary?: Uint8Array;
  readonly query?: Readonly<Record<string, string | undefined>>;
}

export interface FunctionResponse {
  binary?(
    bytes: Uint8Array,
    statusCode?: number,
    headers?: Readonly<Record<string, string>>,
  ): unknown;
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

export interface HttpDependencies {
  readonly createCorrelationId: () => string;
  readonly environment: "development" | "preview" | "production";
  readonly now: () => number;
  readonly publicApi?: PublicApi;
  readonly conversationLifecycle?: ConversationLifecycleHttp;
  readonly externalIssue?: ExternalIssueHttp;
  readonly intelligence?: IntelligenceHttp;
  readonly privacy?: PrivacyHttp;
  readonly projectAdministration?: ProjectAdministrationHttp;
  readonly providerIssueOutbox?: ProviderIssueOutboxHttp;
  readonly providerEventInbox?: ProviderEventInboxHttp;
  readonly providerMaintenance?: ProviderMaintenance;
  readonly providerWebhook?: {
    readonly handle: (request: {
      readonly method: string;
      readonly path: string;
      readonly headers: Readonly<Record<string, string | undefined>>;
      readonly body?: Uint8Array;
    }) => Promise<ProviderWebhookHttpResponse | null>;
  };
  readonly sourceConnections?: SourceConnectionHttp;
  readonly workbench?: WorkbenchHttp;
  readonly release: string;
  readonly startedAt: () => number;
}

const defaultDependencies: HttpDependencies = {
  createCorrelationId: randomUUID,
  environment: "development",
  now: Date.now,
  release: "local",
  startedAt: Date.now,
};

const TEN_MEBIBYTES = 10 * 1024 * 1024;

function ingressProbe(
  req: FunctionRequest,
):
  | { readonly statusCode: 200; readonly body: unknown }
  | { readonly statusCode: 400; readonly body: unknown } {
  const contentType = req.headers?.["content-type"] ?? "";
  const fileBytes = Number(req.headers?.["x-y7-ingress-file-bytes"]);
  const totalBytes = Number(req.headers?.["x-y7-ingress-total-bytes"]);
  const actualBytes = req.bodyBinary?.byteLength;
  const valid =
    contentType.startsWith("multipart/form-data; boundary=") &&
    fileBytes === TEN_MEBIBYTES &&
    Number.isSafeInteger(totalBytes) &&
    totalBytes > fileBytes &&
    actualBytes === totalBytes;

  return valid
    ? { statusCode: 200, body: { accepted: true, fileBytes, totalBytes } }
    : { statusCode: 400, body: { error: "ERR-INGRESS-PROBE-INVALID" } };
}

export async function routeRequest(
  { req, res, log }: FunctionContext,
  dependencies: HttpDependencies = defaultDependencies,
): Promise<unknown> {
  const method = req.method.toUpperCase();
  const requestHeaders = req.headers ?? {};
  const contentType = requestHeaders["content-type"] ?? "";
  const startedAt = dependencies.startedAt();
  const correlationId = dependencies.createCorrelationId();
  const headers = {
    "access-control-allow-headers": "authorization, content-type, x-appwrite-user-id",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-origin": "*",
    "access-control-max-age": "600",
    "cache-control": "no-store",
    "x-correlation-id": correlationId,
  } as const;

  if (method === "OPTIONS") {
    log(
      serializeOperationalEvent({
        event: "api.request.completed",
        correlationId,
        environment: dependencies.environment,
        release: dependencies.release,
        operation: "public_api",
        outcome: "success",
        statusCode: 204,
        durationMs: Math.max(0, dependencies.now() - startedAt),
      }),
    );
    return res.json(null, 204, headers);
  }

  const isHealth = method === "GET" && req.path === "/health";
  const isProviderMaintenance = requestHeaders["x-appwrite-trigger"] === "schedule";
  const isIngressProbe =
    dependencies.environment === "preview" &&
    method === "POST" &&
    req.path === "/operational/ingress-probe";
  const probeResponse = isIngressProbe ? ingressProbe(req) : null;
  const maintenanceResponse = isProviderMaintenance
    ? await dependencies.providerMaintenance
        ?.runOnce()
        .then((body) => ({ statusCode: 200 as const, body }))
        .catch(() => ({
          statusCode: 503 as const,
          body: { error: "ERR-PROVIDER-MAINTENANCE-RETRYABLE" },
        }))
    : null;
  const providerWebhookResponse =
    isHealth || isIngressProbe || isProviderMaintenance
      ? null
      : await dependencies.providerWebhook?.handle({
          method,
          path: req.path,
          headers: requestHeaders,
          ...(req.bodyBinary === undefined ? {} : { body: req.bodyBinary }),
        });
  const providerOutboxResponse =
    isHealth || isIngressProbe || maintenanceResponse || providerWebhookResponse
      ? null
      : await dependencies.providerEventInbox?.handle({
          method,
          path: req.path,
          headers: requestHeaders,
          body:
            method === "POST" && !contentType.startsWith("multipart/form-data")
              ? req.bodyJson
              : undefined,
        });
  const providerIssueOutboxResponse =
    isHealth ||
    isIngressProbe ||
    maintenanceResponse ||
    providerWebhookResponse ||
    providerOutboxResponse
      ? null
      : await dependencies.providerIssueOutbox?.handle({
          method,
          path: req.path,
          headers: requestHeaders,
          body:
            method === "POST" && !contentType.startsWith("multipart/form-data")
              ? req.bodyJson
              : undefined,
        });
  const sourceResponse =
    isHealth ||
    isIngressProbe ||
    maintenanceResponse ||
    providerWebhookResponse ||
    providerOutboxResponse ||
    providerIssueOutboxResponse
      ? null
      : await dependencies.sourceConnections?.handle({
          method,
          path: req.path,
          headers: requestHeaders,
          query: req.query ?? {},
          body:
            method === "POST" && !contentType.startsWith("multipart/form-data")
              ? req.bodyJson
              : undefined,
        });
  const administrationResponse =
    isHealth ||
    isIngressProbe ||
    maintenanceResponse ||
    providerWebhookResponse ||
    providerOutboxResponse ||
    providerIssueOutboxResponse ||
    sourceResponse
      ? null
      : await dependencies.projectAdministration?.handle({
          method,
          path: req.path,
          headers: requestHeaders,
          body:
            method === "POST" && !contentType.startsWith("multipart/form-data")
              ? req.bodyJson
              : undefined,
        });
  const conversationResponse =
    isHealth ||
    isIngressProbe ||
    maintenanceResponse ||
    providerWebhookResponse ||
    providerOutboxResponse ||
    sourceResponse ||
    administrationResponse
      ? null
      : await dependencies.conversationLifecycle?.handle({
          method,
          path: req.path,
          headers: requestHeaders,
          body:
            method === "POST" && !contentType.startsWith("multipart/form-data")
              ? req.bodyJson
              : undefined,
        });
  const workbenchResponse =
    isHealth ||
    isIngressProbe ||
    maintenanceResponse ||
    providerWebhookResponse ||
    providerOutboxResponse ||
    sourceResponse ||
    administrationResponse ||
    conversationResponse
      ? null
      : await dependencies.workbench?.handle({
          method,
          path: req.path,
          headers: requestHeaders,
          query: req.query ?? {},
          body:
            method === "POST" && !contentType.startsWith("multipart/form-data")
              ? req.bodyJson
              : undefined,
        });
  const externalIssueResponse =
    isHealth ||
    isIngressProbe ||
    maintenanceResponse ||
    providerWebhookResponse ||
    providerOutboxResponse ||
    sourceResponse ||
    administrationResponse ||
    conversationResponse ||
    workbenchResponse
      ? null
      : await dependencies.externalIssue?.handle({
          method,
          path: req.path,
          headers: requestHeaders,
          body:
            method === "POST" && !contentType.startsWith("multipart/form-data")
              ? req.bodyJson
              : undefined,
        });
  const intelligenceResponse =
    isHealth ||
    isIngressProbe ||
    maintenanceResponse ||
    providerWebhookResponse ||
    providerOutboxResponse ||
    sourceResponse ||
    administrationResponse ||
    conversationResponse ||
    workbenchResponse ||
    externalIssueResponse
      ? null
      : await dependencies.intelligence?.handle({
          method,
          path: req.path,
          headers: requestHeaders,
          body:
            method === "POST" && !contentType.startsWith("multipart/form-data")
              ? req.bodyJson
              : undefined,
        });
  const privacyResponse =
    isHealth ||
    isIngressProbe ||
    maintenanceResponse ||
    providerWebhookResponse ||
    providerOutboxResponse ||
    sourceResponse ||
    administrationResponse ||
    conversationResponse ||
    workbenchResponse ||
    externalIssueResponse ||
    intelligenceResponse
      ? null
      : await dependencies.privacy?.handle({
          method,
          path: req.path,
          headers: requestHeaders,
          body:
            method === "POST" && !contentType.startsWith("multipart/form-data")
              ? req.bodyJson
              : undefined,
        });
  const publicResponse =
    isHealth ||
    isIngressProbe ||
    maintenanceResponse ||
    providerWebhookResponse ||
    providerOutboxResponse ||
    providerIssueOutboxResponse
      ? null
      : sourceResponse ||
          administrationResponse ||
          conversationResponse ||
          workbenchResponse ||
          externalIssueResponse ||
          intelligenceResponse ||
          privacyResponse
        ? null
        : await dependencies.publicApi?.handle({
            method,
            path: req.path,
            headers: requestHeaders,
            body:
              method === "POST" && !contentType.startsWith("multipart/form-data")
                ? req.bodyJson
                : undefined,
          });
  const statusCode = isHealth
    ? 200
    : (probeResponse?.statusCode ??
      maintenanceResponse?.statusCode ??
      providerWebhookResponse?.statusCode ??
      providerOutboxResponse?.statusCode ??
      providerIssueOutboxResponse?.statusCode ??
      sourceResponse?.statusCode ??
      administrationResponse?.statusCode ??
      conversationResponse?.statusCode ??
      workbenchResponse?.statusCode ??
      externalIssueResponse?.statusCode ??
      intelligenceResponse?.statusCode ??
      privacyResponse?.statusCode ??
      publicResponse?.statusCode ??
      404);
  const operation = isHealth
    ? "health"
    : probeResponse
      ? "ingress_probe"
      : maintenanceResponse
        ? "provider_maintenance"
        : providerWebhookResponse
          ? "provider_webhook"
          : providerOutboxResponse
            ? "provider_event_inbox"
            : providerIssueOutboxResponse
              ? "provider_issue_outbox"
              : sourceResponse
                ? "source_connection"
                : administrationResponse
                  ? "project_administration"
                  : conversationResponse
                    ? "conversation_lifecycle"
                    : workbenchResponse
                      ? "workbench"
                      : externalIssueResponse
                        ? "external_issue"
                        : intelligenceResponse
                          ? "intelligence"
                          : privacyResponse
                            ? "privacy"
                            : publicResponse
                              ? "public_api"
                              : "unknown";
  const outcome = isHealth
    ? "success"
    : (probeResponse ??
        maintenanceResponse ??
        providerWebhookResponse ??
        providerOutboxResponse ??
        providerIssueOutboxResponse ??
        sourceResponse ??
        administrationResponse ??
        conversationResponse ??
        workbenchResponse ??
        externalIssueResponse ??
        intelligenceResponse ??
        privacyResponse ??
        publicResponse)
      ? statusCode < 400
        ? "success"
        : "rejected"
      : "not_found";
  log(
    serializeOperationalEvent({
      event: "api.request.completed",
      correlationId,
      environment: dependencies.environment,
      release: dependencies.release,
      operation,
      outcome,
      statusCode,
      durationMs: Math.max(0, dependencies.now() - startedAt),
    }),
  );

  if (isHealth) {
    return res.json({ status: "ok" }, statusCode, headers);
  }

  if (probeResponse) {
    return res.json(probeResponse.body, probeResponse.statusCode, headers);
  }

  if (maintenanceResponse) {
    return res.json(maintenanceResponse.body, maintenanceResponse.statusCode, headers);
  }

  if (providerWebhookResponse) {
    return res.json(
      providerWebhookResponse.body,
      providerWebhookResponse.statusCode,
      headers,
    );
  }

  if (providerOutboxResponse) {
    return res.json(
      providerOutboxResponse.body,
      providerOutboxResponse.statusCode,
      headers,
    );
  }

  if (providerIssueOutboxResponse) {
    return res.json(
      providerIssueOutboxResponse.body,
      providerIssueOutboxResponse.statusCode,
      headers,
    );
  }

  if (sourceResponse) {
    return res.json(sourceResponse.body, sourceResponse.statusCode, headers);
  }

  if (administrationResponse) {
    return res.json(
      administrationResponse.body,
      administrationResponse.statusCode,
      headers,
    );
  }

  if (conversationResponse) {
    return res.json(
      conversationResponse.body,
      conversationResponse.statusCode,
      headers,
    );
  }

  if (workbenchResponse) {
    return res.json(workbenchResponse.body, workbenchResponse.statusCode, headers);
  }

  if (externalIssueResponse) {
    return res.json(
      externalIssueResponse.body,
      externalIssueResponse.statusCode,
      headers,
    );
  }

  if (intelligenceResponse) {
    return res.json(
      intelligenceResponse.body,
      intelligenceResponse.statusCode,
      headers,
    );
  }

  if (privacyResponse) {
    return res.json(privacyResponse.body, privacyResponse.statusCode, headers);
  }

  if (publicResponse) {
    if (publicResponse.binary) {
      if (!res.binary) {
        return res.json({ error: "ERR-ATTACHMENT-UNAVAILABLE" }, 503, headers);
      }
      return res.binary(
        Buffer.from(publicResponse.binary.bytes),
        publicResponse.statusCode,
        {
          ...headers,
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(publicResponse.binary.displayName)}`,
          "content-length": String(publicResponse.binary.bytes.byteLength),
          "content-type": publicResponse.binary.mediaType,
        },
      );
    }
    return res.json(publicResponse.body, publicResponse.statusCode, headers);
  }

  return res.json({ error: "not_found" }, statusCode, headers);
}
