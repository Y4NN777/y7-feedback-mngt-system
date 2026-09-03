import { createHmac, randomBytes } from "node:crypto";

import { Client, Query, TablesDB } from "node-appwrite";

import { createAppwriteAbuseCounterStore } from "./appwrite-abuse-counter-store.js";
import type { AbuseCounterRequest } from "./abuse.js";

if (!process.argv.includes("--apply")) throw new Error("ABUSE_VERIFY_REQUIRES_APPLY");

const required = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`ABUSE_VERIFY_MISSING:${key}`);
  return value;
};
const endpoint = required("APPWRITE_ENDPOINT");
const projectId = required("APPWRITE_PROJECT_ID");
const apiKey = required("APPWRITE_API_KEY");
const databaseId = required("APPWRITE_DATABASE_ID");
const tableId =
  process.env.APPWRITE_ABUSE_COUNTERS_TABLE_ID?.trim() || "abuse_counters";
const domain = required("Y7_FUNCTION_DOMAIN_URL").replace(/\/$/u, "");
const fixtureKeyId = `verify_${randomBytes(6).toString("hex")}`;
const fixtureKey = randomBytes(32);
const tables = new TablesDB(
  new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey),
);
const store = createAppwriteAbuseCounterStore(
  {
    listRows: async (input) => ({
      rows: (await tables.listRows({ ...input, queries: [...input.queries] })).rows,
    }),
    getRow: (input) => tables.getRow(input),
    createRow: (input) =>
      tables.createRow({ ...input, permissions: [...input.permissions] }),
    incrementRowColumn: (input) => tables.incrementRowColumn(input),
    decrementRowColumn: (input) => tables.decrementRowColumn(input),
  },
  { databaseId, abuseCountersTableId: tableId },
  {
    equal: (attribute, values) => Query.equal(attribute, [...values]),
    limit: (value) => Query.limit(value),
  },
);

const counter = (
  dimension: AbuseCounterRequest["dimension"],
  subject: string,
  limit: number,
  windowMs: number,
  amount = 1,
  previous?: string,
): AbuseCounterRequest => {
  const digest = (value: string) =>
    createHmac("sha256", fixtureKey).update(value).digest("base64url");
  const activeDigest = digest(subject);
  return {
    dimension,
    subjectDigests: previous ? [activeDigest, digest(previous)] : [activeDigest],
    activeDigest,
    keyId: fixtureKeyId,
    amount,
    limit,
    windowMs,
  };
};
const consumeBoundary = async (
  candidate: AbuseCounterRequest,
  allowed: number,
  now: string,
) => {
  const result = await store.consume({
    counters: [{ ...candidate, amount: allowed }],
    now,
  });
  if (result.status !== "allowed") throw new Error("ABUSE_VERIFY_EARLY_LIMIT");
  const limited = await store.consume({
    counters: [{ ...candidate, amount: 1 }],
    now,
  });
  if (limited.status !== "limited" || limited.retryAfterSeconds < 1)
    throw new Error("ABUSE_VERIFY_BOUNDARY_FAILED");
};

const created = new Set<string>();
try {
  const now = "2026-09-03T12:00:10.000Z";
  await consumeBoundary(
    counter("public_ip_minute", "verify-public", 60, 60_000),
    60,
    now,
  );
  await consumeBoundary(
    counter("intake_ip_minute", "verify-intake", 10, 60_000),
    10,
    now,
  );
  await consumeBoundary(
    counter("attachment_ip_minute", "verify-attachment", 20, 60_000),
    20,
    now,
  );
  await consumeBoundary(
    counter("external_identity_hour", "verify-identity", 30, 3_600_000),
    30,
    now,
  );
  const old = counter("public_ip_minute", "verify-rotation-old", 1, 60_000);
  await store.consume({ counters: [old], now });
  const rotated = counter(
    "public_ip_minute",
    "verify-rotation-new",
    1,
    60_000,
    1,
    "verify-rotation-old",
  );
  if ((await store.consume({ counters: [rotated], now })).status !== "limited")
    throw new Error("ABUSE_VERIFY_ROTATION_FAILED");
  if (
    (await store.consume({ counters: [rotated], now: "2026-09-03T12:01:00.000Z" }))
      .status !== "allowed"
  )
    throw new Error("ABUSE_VERIFY_ROLLOVER_FAILED");

  const fixtureRows = await tables.listRows({
    databaseId,
    tableId,
    queries: [Query.equal("keyId", [fixtureKeyId]), Query.limit(100)],
    total: false,
  });
  for (const row of fixtureRows.rows) {
    created.add(row.$id);
    const serialized = JSON.stringify(row);
    if (/203\.0\.113\.|2001:db8|verify-(public|intake|identity)/u.test(serialized))
      throw new Error("ABUSE_VERIFY_PROHIBITED_SUBJECT");
  }

  const before = await tables.listRows({
    databaseId,
    tableId,
    queries: [Query.equal("keyId", ["abuse_2026_09"]), Query.limit(100)],
    total: false,
  });
  const beforeIds = new Set(before.rows.map((row) => row.$id));
  const responses = await Promise.all(
    Array.from({ length: 61 }, () =>
      fetch(`${domain}/v1/projects/abuse-verifier-not-found`),
    ),
  );
  const after = await tables.listRows({
    databaseId,
    tableId,
    queries: [Query.equal("keyId", ["abuse_2026_09"]), Query.limit(100)],
    total: false,
  });
  for (const row of after.rows) if (!beforeIds.has(row.$id)) created.add(row.$id);
  const limitedResponses = responses.filter(({ status }) => status === 429);
  const unexpectedResponses = responses.filter(
    ({ status }) => status !== 404 && status !== 429,
  );
  const boundary = limitedResponses[0];
  if (
    limitedResponses.length !== 1 ||
    unexpectedResponses.length !== 0 ||
    boundary?.headers.get("cache-control") !== "no-store" ||
    !/^\d+$/u.test(boundary.headers.get("retry-after") ?? "") ||
    ((await boundary.json()) as { error?: string }).error !== "ERR-ABUSE-LIMITED"
  ) {
    const statuses = responses.reduce<Record<string, number>>((counts, response) => {
      const key = String(response.status);
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
    throw new Error(`ABUSE_VERIFY_DEPLOYED_429_FAILED:${JSON.stringify({ statuses })}`);
  }
  process.stdout.write(
    `${JSON.stringify({ result: "APPWRITE_G4_ABUSE_PASSED", boundaries: [61, 11, 21, 31], deployed429: true, rawIpPersisted: false })}\n`,
  );
} finally {
  await Promise.allSettled(
    [...created].map((rowId) => tables.deleteRow({ databaseId, tableId, rowId })),
  );
}
