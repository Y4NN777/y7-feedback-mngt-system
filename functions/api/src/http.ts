import { randomUUID } from "node:crypto";

import { classifyHttpSloMeasurements } from "./http-slo.js";
import { serializeOperationalEvent } from "./observability.js";
import type { ConversationLifecycleHttp } from "./conversation-lifecycle-http.js";
import type { ExternalIssueHttp } from "./external-issue-http.js";
import type { IntelligenceHttp } from "./intelligence-http.js";
import type { PrivacyHttp } from "./privacy-http.js";
import type { PlatformAccessHttp } from "./platform-access-http.js";
import type { PublicApi } from "./public-api.js";
import type { ProjectAdministrationHttp } from "./project-administration-http.js";
import type { ProviderIssueOutboxHttp } from "./provider-issue-outbox-http.js";
import type { ProviderEventInboxHttp } from "./provider-event-inbox-http.js";
import type {
  ProviderMaintenance,
  ProviderMaintenanceCapability,
} from "./provider-maintenance.js";
import { ProviderMaintenanceFailure } from "./provider-maintenance.js";
import type { ProviderMaintenanceHttp } from "./provider-maintenance-http.js";
import type { ProviderWebhookHttpResponse } from "./provider-webhook-http.js";
import type { SourceConnectionHttp } from "./source-connection-http.js";
import type { WorkbenchHttp } from "./workbench-http.js";
import type { AbuseGateOutcome, AbuseRequest, AbuseReservation } from "./abuse.js";
import { composeHttpRouteRegistry } from "./http-route-composition.js";
import {
  dispatchHttpRouteRegistry,
  emitHttpRouteResponse,
  type HttpRouteRequest,
} from "./http-route-registry.js";

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
  readonly abuse?: {
    readonly reserve: (request: AbuseRequest, now: string) => Promise<AbuseGateOutcome>;
    readonly settle: (
      reservation: AbuseReservation,
      accepted: boolean,
      now: string,
    ) => Promise<void>;
  };
  readonly createCorrelationId: () => string;
  readonly environment: "development" | "preview" | "production";
  readonly now: () => number;
  readonly publicApi?: PublicApi;
  readonly conversationLifecycle?: ConversationLifecycleHttp;
  readonly externalIssue?: ExternalIssueHttp;
  readonly intelligence?: IntelligenceHttp;
  readonly privacy?: PrivacyHttp;
  readonly platformAccess?: PlatformAccessHttp;
  readonly projectAdministration?: ProjectAdministrationHttp;
  readonly providerIssueOutbox?: ProviderIssueOutboxHttp;
  readonly providerEventInbox?: ProviderEventInboxHttp;
  readonly providerMaintenance?: ProviderMaintenance;
  readonly authoritativeProjection?: ProviderMaintenanceCapability;
  readonly providerMaintenanceHttp?: ProviderMaintenanceHttp;
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
    "access-control-allow-headers":
      "authorization, content-type, x-appwrite-user-id, x-y7-file-name, x-y7-operation-id",
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
  const appwriteTrigger = requestHeaders["x-appwrite-trigger"];
  const isScheduledMaintenance = appwriteTrigger === "schedule";
  const isAuthoritativeProjection = appwriteTrigger === "event";
  const isProviderMaintenance = isScheduledMaintenance || isAuthoritativeProjection;
  const isIngressProbe =
    dependencies.environment === "preview" &&
    method === "POST" &&
    req.path === "/operational/ingress-probe";
  const abuseOutcome =
    isHealth || isIngressProbe || isProviderMaintenance
      ? ({ status: "allowed", reservation: {} } as const)
      : await dependencies.abuse?.reserve(
          {
            method,
            path: req.path,
            headers: requestHeaders,
            ...(method !== "POST" || contentType.startsWith("multipart/form-data")
              ? {}
              : { body: req.bodyJson }),
          },
          new Date(dependencies.now()).toISOString(),
        );
  if (abuseOutcome?.status === "limited" || abuseOutcome?.status === "unavailable") {
    const statusCode = abuseOutcome.status === "limited" ? 429 : 503;
    log(
      serializeOperationalEvent({
        event: "api.request.completed",
        correlationId,
        environment: dependencies.environment,
        release: dependencies.release,
        operation: "public_api",
        outcome: "rejected",
        statusCode,
        durationMs: Math.max(0, dependencies.now() - startedAt),
      }),
    );
    return res.json(
      {
        error:
          abuseOutcome.status === "limited"
            ? "ERR-ABUSE-LIMITED"
            : "ERR-ABUSE-UNAVAILABLE",
      },
      statusCode,
      abuseOutcome.status === "limited"
        ? { ...headers, "retry-after": String(abuseOutcome.retryAfterSeconds) }
        : headers,
    );
  }
  const probeResponse = isIngressProbe ? ingressProbe(req) : null;
  const maintenanceResponse = isProviderMaintenance
    ? await (
        isAuthoritativeProjection
          ? dependencies.authoritativeProjection
          : dependencies.providerMaintenance
      )
        ?.runOnce()
        .then((body) => ({ statusCode: 200 as const, body }))
        .catch((error: unknown) => {
          const failedCapabilities =
            error instanceof ProviderMaintenanceFailure
              ? error.failedCapabilities
              : typeof error === "object" &&
                  error !== null &&
                  "name" in error &&
                  error.name === "ProviderMaintenanceFailure" &&
                  "failedCapabilities" in error &&
                  Array.isArray(error.failedCapabilities) &&
                  error.failedCapabilities.every((value) => typeof value === "string")
                ? error.failedCapabilities
                : undefined;
          if (failedCapabilities !== undefined)
            log(
              JSON.stringify({
                event: "provider.maintenance.failed",
                failedCapabilities,
              }),
            );
          return {
            statusCode: 503 as const,
            body: { error: "ERR-PROVIDER-MAINTENANCE-RETRYABLE" },
          };
        })
    : null;
  const routeRequest: HttpRouteRequest = {
    method,
    path: req.path,
    headers: requestHeaders,
    query: req.query ?? {},
    ...(req.bodyBinary === undefined ? {} : { bodyBinary: req.bodyBinary }),
  };
  if (method === "POST" && !contentType.startsWith("multipart/form-data"))
    Object.defineProperty(routeRequest, "body", {
      enumerable: true,
      get: () => req.bodyJson,
    });
  const routedResponse =
    isHealth || isIngressProbe || isProviderMaintenance || maintenanceResponse
      ? undefined
      : await dispatchHttpRouteRegistry(
          composeHttpRouteRegistry(dependencies),
          routeRequest,
        );
  if (abuseOutcome?.status === "allowed") {
    try {
      await dependencies.abuse?.settle(
        abuseOutcome.reservation,
        routedResponse?.operation === "public_api" &&
          routedResponse.response.statusCode === 201,
        new Date(dependencies.now()).toISOString(),
      );
    } catch {
      log(
        serializeOperationalEvent({
          event: "api.request.completed",
          correlationId,
          environment: dependencies.environment,
          release: dependencies.release,
          operation: "public_api",
          outcome: "rejected",
          statusCode: 503,
          durationMs: Math.max(0, dependencies.now() - startedAt),
        }),
      );
    }
  }
  const statusCode = isHealth
    ? 200
    : (probeResponse?.statusCode ??
      maintenanceResponse?.statusCode ??
      routedResponse?.response.statusCode ??
      404);
  const operation = isHealth
    ? "health"
    : probeResponse
      ? "ingress_probe"
      : maintenanceResponse
        ? "provider_maintenance"
        : (routedResponse?.operation ?? "unknown");
  const outcome = isHealth
    ? "success"
    : (probeResponse ?? maintenanceResponse ?? routedResponse?.response)
      ? statusCode < 400
        ? "success"
        : "rejected"
      : "not_found";
  const completedAt = dependencies.now();
  const durationMs = Math.max(0, completedAt - startedAt);
  log(
    serializeOperationalEvent({
      event: "api.request.completed",
      correlationId,
      environment: dependencies.environment,
      release: dependencies.release,
      operation,
      outcome,
      statusCode,
      durationMs,
    }),
  );
  for (const measurement of classifyHttpSloMeasurements({
    method,
    path: req.path,
    operation,
    statusCode,
    durationMs,
    measuredAt: new Date(completedAt).toISOString(),
    environment: dependencies.environment,
    release: dependencies.release,
  }))
    log(serializeOperationalEvent({ ...measurement }));
  const responseHeaders = {
    ...headers,
    "server-timing": `app;dur=${String(durationMs)}`,
  } as const;

  if (isHealth) {
    return res.json(
      {
        status: "ok",
        environment: dependencies.environment,
        release: dependencies.release,
      },
      statusCode,
      responseHeaders,
    );
  }

  if (probeResponse) {
    return res.json(probeResponse.body, probeResponse.statusCode, responseHeaders);
  }

  if (maintenanceResponse) {
    return res.json(
      maintenanceResponse.body,
      maintenanceResponse.statusCode,
      responseHeaders,
    );
  }

  if (routedResponse) {
    return emitHttpRouteResponse(res, routedResponse.response, responseHeaders);
  }

  return res.json({ error: "not_found" }, statusCode, responseHeaders);
}
