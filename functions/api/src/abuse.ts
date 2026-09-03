import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export type AbuseDimension =
  | "public_ip_minute"
  | "intake_ip_minute"
  | "attachment_ip_minute"
  | "external_identity_hour";

export interface AbuseCounterRequest {
  readonly dimension: AbuseDimension;
  readonly subjectDigests: readonly [string, ...string[]];
  readonly activeDigest: string;
  readonly keyId: string;
  readonly amount: number;
  readonly limit: number;
  readonly windowMs: number;
}

export interface AbuseCounterReceipt {
  readonly dimension: AbuseDimension;
  readonly rowId: string;
  readonly amount: number;
}

export interface AbuseCounterStore {
  consume(input: {
    readonly counters: readonly AbuseCounterRequest[];
    readonly now: string;
  }): Promise<
    | { readonly status: "allowed"; readonly receipts: readonly AbuseCounterReceipt[] }
    | { readonly status: "limited"; readonly retryAfterSeconds: number }
  >;
  release(input: { readonly receipt: AbuseCounterReceipt }): Promise<void>;
}

export interface AbuseKeyring {
  readonly active: { readonly id: string; readonly material: Uint8Array };
  readonly previous?: { readonly id: string; readonly material: Uint8Array };
}

export interface AbuseProjectScopeResolver {
  resolve(
    slug: string,
  ): Promise<
    | { readonly workspaceId: string; readonly projectId: string }
    | { readonly status: "denied" | "retryable" }
  >;
}

export interface AbuseRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
}

export interface AbuseReservation {
  readonly identity?: AbuseCounterReceipt;
}

export type AbuseGateOutcome =
  | { readonly status: "allowed"; readonly reservation: AbuseReservation }
  | { readonly status: "limited"; readonly retryAfterSeconds: number }
  | { readonly status: "unavailable" };

const minute = 60_000;
const hour = 60 * minute;
const keyIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeSourceIp(value: string): string | undefined {
  const candidate = value.trim();
  if (isIP(candidate) === 4) return candidate;
  if (isIP(candidate) !== 6) return undefined;
  let normalized: string;
  try {
    normalized = new URL(`http://[${candidate}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return undefined;
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(normalized);
  if (!mapped) return normalized;
  const high = Number.parseInt(mapped[1] ?? "", 16);
  const low = Number.parseInt(mapped[2] ?? "", 16);
  if (!Number.isSafeInteger(high) || !Number.isSafeInteger(low)) return undefined;
  return `${String(high >>> 8)}.${String(high & 255)}.${String(low >>> 8)}.${String(low & 255)}`;
}

function validateKeyring(keyring: AbuseKeyring): void {
  const keys = [keyring.active, keyring.previous].filter(
    (value): value is NonNullable<typeof value> => value !== undefined,
  );
  if (
    keys.some(
      ({ id, material }) => !keyIdPattern.test(id) || material.byteLength < 32,
    ) ||
    new Set(keys.map(({ id }) => id)).size !== keys.length
  )
    throw new Error("ABUSE_KEYRING_INVALID");
}

function digest(material: Uint8Array, subject: string): string {
  return createHmac("sha256", material).update(subject).digest("base64url");
}

function counter(
  dimension: AbuseDimension,
  subject: string,
  amount: number,
  limit: number,
  windowMs: number,
  keyring: AbuseKeyring,
): AbuseCounterRequest {
  const activeDigest = digest(keyring.active.material, subject);
  const candidates = [
    activeDigest,
    ...(keyring.previous ? [digest(keyring.previous.material, subject)] : []),
  ];
  return {
    dimension,
    activeDigest,
    subjectDigests: candidates as [string, ...string[]],
    keyId: keyring.active.id,
    amount,
    limit,
    windowMs,
  };
}

function publicPath(path: string): boolean {
  return (
    path.startsWith("/v1/projects/") ||
    path.startsWith("/v1/feedback/") ||
    path.startsWith("/providers/")
  );
}

function intakePath(path: string): boolean {
  return /^\/v1\/projects\/[A-Za-z0-9][A-Za-z0-9._-]{0,62}\/feedback$/u.test(path);
}

function intakeDetails(body: unknown): {
  readonly attachmentAttempts: number;
  readonly externalSubject?: string;
} {
  if (!object(body) || !object(body.feedback)) return { attachmentAttempts: 0 };
  const attachments = body.feedback.attachmentNames;
  const attachmentAttempts = Array.isArray(attachments)
    ? Math.min(attachments.length, 1_000)
    : 0;
  const reporter = body.feedback.reporter;
  if (
    !object(reporter) ||
    reporter.kind !== "external" ||
    typeof reporter.issuer !== "string" ||
    typeof reporter.applicationId !== "string" ||
    typeof reporter.value !== "string"
  )
    return { attachmentAttempts };
  return {
    attachmentAttempts,
    externalSubject: JSON.stringify([
      reporter.issuer.trim(),
      reporter.applicationId.trim(),
      reporter.value.trim(),
    ]),
  };
}

export function createAbuseGate(
  store: AbuseCounterStore,
  keyring: AbuseKeyring,
  projects: AbuseProjectScopeResolver,
) {
  validateKeyring(keyring);
  return {
    async reserve(request: AbuseRequest, now: string): Promise<AbuseGateOutcome> {
      if (!publicPath(request.path)) return { status: "allowed", reservation: {} };
      const ip = normalizeSourceIp(request.headers["x-appwrite-client-ip"] ?? "");
      if (!ip) return { status: "unavailable" };
      const attemptCounters: AbuseCounterRequest[] = [
        counter("public_ip_minute", `ip:${ip}`, 1, 60, minute, keyring),
      ];
      let identity: AbuseCounterRequest | undefined;
      if (request.method.toUpperCase() === "POST" && intakePath(request.path)) {
        attemptCounters.push(
          counter("intake_ip_minute", `ip:${ip}`, 1, 10, minute, keyring),
        );
        const details = intakeDetails(request.body);
        if (details.attachmentAttempts > 0)
          attemptCounters.push(
            counter(
              "attachment_ip_minute",
              `ip:${ip}`,
              details.attachmentAttempts,
              20,
              minute,
              keyring,
            ),
          );
        const projectSlug = request.path.split("/")[3];
        if (details.externalSubject && projectSlug) {
          let scope: Awaited<ReturnType<AbuseProjectScopeResolver["resolve"]>>;
          try {
            scope = await projects.resolve(projectSlug);
          } catch {
            return { status: "unavailable" };
          }
          if ("status" in scope) {
            if (scope.status === "retryable") return { status: "unavailable" };
          } else {
            identity = counter(
              "external_identity_hour",
              `workspace:${scope.workspaceId}:project:${scope.projectId}:${details.externalSubject}`,
              1,
              30,
              hour,
              keyring,
            );
          }
        }
      }
      try {
        const attempts = await store.consume({ counters: attemptCounters, now });
        if (attempts.status === "limited") return attempts;
        if (identity) {
          const accepted = await store.consume({ counters: [identity], now });
          if (accepted.status === "limited") return accepted;
          const receipt = accepted.receipts[0];
          if (!receipt) return { status: "unavailable" };
          return { status: "allowed", reservation: { identity: receipt } };
        }
        return { status: "allowed", reservation: {} };
      } catch {
        return { status: "unavailable" };
      }
    },
    async settle(
      reservation: AbuseReservation,
      accepted: boolean,
      now: string,
    ): Promise<void> {
      if (accepted || !reservation.identity) return;
      void now;
      await store.release({ receipt: reservation.identity });
    },
  };
}
