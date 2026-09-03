import { describe, expect, it, vi } from "vitest";

import {
  createAbuseGate,
  normalizeSourceIp,
  type AbuseCounterStore,
  type AbuseProjectScopeResolver,
} from "./abuse";

const keyring = {
  active: { id: "2026_09", material: new Uint8Array(32).fill(1) },
  previous: { id: "2026_08", material: new Uint8Array(32).fill(2) },
};

function setup(
  consume: AbuseCounterStore["consume"] = ({ counters }) =>
    Promise.resolve({
      status: "allowed",
      receipts: counters.map((counter, index) => ({
        dimension: counter.dimension,
        rowId: `counter_${String(index)}`,
        amount: counter.amount,
      })),
    }),
) {
  const consumeSpy = vi.fn(consume);
  const releaseSpy = vi.fn((input: Parameters<AbuseCounterStore["release"]>[0]) => {
    void input;
    return Promise.resolve();
  });
  const store: AbuseCounterStore = {
    consume: (input) => consumeSpy(input),
    release: (input) => releaseSpy(input),
  };
  const resolve = vi.fn<AbuseProjectScopeResolver["resolve"]>(() =>
    Promise.resolve({ workspaceId: "workspace_1", projectId: "project_1" }),
  );
  return {
    gate: createAbuseGate(store, keyring, { resolve }),
    consumeSpy,
    releaseSpy,
    resolve,
    store,
  };
}

const intake = {
  method: "POST",
  path: "/v1/projects/wisemoney/feedback",
  headers: { "x-appwrite-client-ip": "192.0.2.10" },
  body: {
    feedback: {
      reporter: {
        kind: "external",
        issuer: "https://issuer.example",
        applicationId: "app_1",
        value: "subject_1",
      },
      attachmentNames: ["one.txt", "two.txt"],
    },
  },
} as const;

describe("anti-abuse gate", () => {
  it("BDD-ABUSE-001 canonicalizes IPv4, IPv6 and mapped IPv4", () => {
    expect(normalizeSourceIp(" 192.0.2.128 ")).toBe("192.0.2.128");
    expect(normalizeSourceIp("2001:0DB8:0000:0000:0000:FF00:0042:8329")).toBe(
      "2001:db8::ff00:42:8329",
    );
    expect(normalizeSourceIp("::ffff:192.0.2.128")).toBe("192.0.2.128");
    expect(normalizeSourceIp("not-an-ip")).toBeUndefined();
  });

  it("BDD-ABUSE-002 reserves all applicable independent dimensions", async () => {
    const { gate, consumeSpy, resolve } = setup();
    const result = await gate.reserve(intake, "2026-09-03T12:00:00.000Z");
    expect(result.status).toBe("allowed");
    if (result.status !== "allowed") throw new Error("fixture failed");
    expect(result.reservation.identity).toBeDefined();
    const calls = consumeSpy.mock.calls;
    expect(calls[0]?.[0].counters.map(({ dimension }) => dimension)).toEqual([
      "public_ip_minute",
      "intake_ip_minute",
      "attachment_ip_minute",
    ]);
    expect(calls[0]?.[0].counters[2]?.amount).toBe(2);
    expect(calls[1]?.[0].counters[0]?.dimension).toBe("external_identity_hour");
    expect(calls[0]?.[0].counters[0]?.subjectDigests).toHaveLength(2);
    expect(resolve).toHaveBeenCalledWith("wisemoney");
  });

  it("BDD-ABUSE-003 releases external identity reservations when intake is rejected", async () => {
    const { gate, releaseSpy } = setup();
    const outcome = await gate.reserve(intake, "2026-09-03T12:00:00.000Z");
    if (outcome.status !== "allowed") throw new Error("fixture failed");
    await gate.settle(outcome.reservation, false, "2026-09-03T12:00:01.000Z");
    expect(releaseSpy).toHaveBeenCalledOnce();
    await gate.settle(outcome.reservation, true, "2026-09-03T12:00:01.000Z");
    expect(releaseSpy).toHaveBeenCalledOnce();
  });

  it("BDD-ABUSE-004 returns safe limiting and fails closed on missing IP or storage", async () => {
    const limited = setup(() =>
      Promise.resolve({ status: "limited", retryAfterSeconds: 17 }),
    );
    await expect(
      limited.gate.reserve(intake, "2026-09-03T12:00:00.000Z"),
    ).resolves.toEqual({ status: "limited", retryAfterSeconds: 17 });
    const unavailable = setup(() => Promise.reject(new Error("storage")));
    await expect(
      unavailable.gate.reserve(intake, "2026-09-03T12:00:00.000Z"),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      unavailable.gate.reserve({ ...intake, headers: {} }, "2026-09-03T12:00:00.000Z"),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("BDD-ABUSE-005 ignores trusted/internal routes and rejects invalid keyrings", async () => {
    const { gate, consumeSpy } = setup();
    await expect(
      gate.reserve(
        { method: "GET", path: "/health", headers: {} },
        "2026-09-03T12:00:00.000Z",
      ),
    ).resolves.toEqual({ status: "allowed", reservation: {} });
    expect(consumeSpy).not.toHaveBeenCalled();
    expect(() =>
      createAbuseGate(
        {
          consume: (input) => consumeSpy(input),
          release: () => Promise.resolve(),
        },
        { active: { id: "bad id", material: new Uint8Array(2) } },
        { resolve: () => Promise.resolve({ status: "denied" }) },
      ),
    ).toThrow("ABUSE_KEYRING_INVALID");
  });

  it("BDD-ABUSE-006 accepts the Appwrite CDN IP only with injected execution authority", async () => {
    const trusted = setup();
    await expect(
      trusted.gate.reserve(
        {
          ...intake,
          headers: {
            "x-appwrite-trigger": "http",
            "x-appwrite-key": "dynamic-authority",
            "x-cdn-client-ip": "203.0.113.77",
          },
        },
        "2026-09-03T12:00:00.000Z",
      ),
    ).resolves.toMatchObject({ status: "allowed" });
    const untrusted = setup();
    await expect(
      untrusted.gate.reserve(
        {
          ...intake,
          headers: {
            "x-cdn-client-ip": "203.0.113.77",
            "x-forwarded-for": "203.0.113.77",
          },
        },
        "2026-09-03T12:00:00.000Z",
      ),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("BDD-ABUSE-007 handles header adapters, denied scopes and retryable resolution", async () => {
    const adapterHeaders = {
      get: (name: string) =>
        name === "x-appwrite-client-ip" ? "203.0.113.88" : undefined,
    } as unknown as Readonly<Record<string, string | undefined>>;
    const adapted = setup();
    await expect(
      adapted.gate.reserve(
        { method: "GET", path: "/v1/feedback/reference", headers: adapterHeaders },
        "2026-09-03T12:00:00.000Z",
      ),
    ).resolves.toMatchObject({ status: "allowed" });
    const upperCase = setup();
    await expect(
      upperCase.gate.reserve(
        {
          method: "GET",
          path: "/providers/github/connect",
          headers: { "X-Appwrite-Client-IP": "203.0.113.89" },
        },
        "2026-09-03T12:00:00.000Z",
      ),
    ).resolves.toMatchObject({ status: "allowed" });

    const denied = setup();
    denied.resolve.mockResolvedValueOnce({ status: "denied" });
    await expect(
      denied.gate.reserve(intake, "2026-09-03T12:00:00.000Z"),
    ).resolves.toMatchObject({ status: "allowed", reservation: {} });
    const retryable = setup();
    retryable.resolve.mockResolvedValueOnce({ status: "retryable" });
    await expect(
      retryable.gate.reserve(intake, "2026-09-03T12:00:00.000Z"),
    ).resolves.toEqual({ status: "unavailable" });
    const failed = setup();
    failed.resolve.mockRejectedValueOnce(new Error("storage"));
    await expect(
      failed.gate.reserve(intake, "2026-09-03T12:00:00.000Z"),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("BDD-ABUSE-008 handles non-intake bodies and missing identity receipts", async () => {
    const noPrevious = setup();
    const gate = createAbuseGate(
      noPrevious.store,
      { active: keyring.active },
      { resolve: () => Promise.resolve({ status: "denied" }) },
    );
    await expect(
      gate.reserve(
        {
          method: "POST",
          path: "/v1/projects/wisemoney/feedback",
          headers: { "x-appwrite-client-ip": "203.0.113.90" },
          body: { feedback: { reporter: { kind: "unidentified" } } },
        },
        "2026-09-03T12:00:00.000Z",
      ),
    ).resolves.toMatchObject({ status: "allowed" });
    await expect(
      gate.reserve(
        {
          method: "POST",
          path: "/v1/projects/wisemoney/feedback",
          headers: { "x-appwrite-client-ip": "203.0.113.91" },
          body: null,
        },
        "2026-09-03T12:00:00.000Z",
      ),
    ).resolves.toMatchObject({ status: "allowed" });
    let calls = 0;
    const identityLimited = setup(({ counters }) => {
      calls += 1;
      return calls === 2
        ? Promise.resolve({ status: "limited", retryAfterSeconds: 42 })
        : Promise.resolve({
            status: "allowed",
            receipts: counters.map((candidate, index) => ({
              dimension: candidate.dimension,
              rowId: `allowed_${String(index)}`,
              amount: candidate.amount,
            })),
          });
    });
    await expect(
      identityLimited.gate.reserve(intake, "2026-09-03T12:00:00.000Z"),
    ).resolves.toEqual({ status: "limited", retryAfterSeconds: 42 });
    const missingReceipt = setup(({ counters }) =>
      Promise.resolve({ status: "allowed", receipts: counters.length > 1 ? [] : [] }),
    );
    await expect(
      missingReceipt.gate.reserve(intake, "2026-09-03T12:00:00.000Z"),
    ).resolves.toEqual({ status: "unavailable" });
    expect(() =>
      createAbuseGate(
        noPrevious.store,
        {
          active: keyring.active,
          previous: { id: keyring.active.id, material: new Uint8Array(32).fill(3) },
        },
        { resolve: () => Promise.resolve({ status: "denied" }) },
      ),
    ).toThrow("ABUSE_KEYRING_INVALID");
  });
});
