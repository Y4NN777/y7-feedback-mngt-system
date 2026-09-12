import { describe, expect, it } from "vitest";

import { createPlatformAccessAuditId } from "./platform-access-audit-id";

describe("createPlatformAccessAuditId", () => {
  it("BDD-PLATFORM-ACCESS-045 always creates an Appwrite-safe deterministic id", () => {
    const first = createPlatformAccessAuditId("g4pe_boundary", 1);

    expect(first).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u);
    expect(first).toBe(createPlatformAccessAuditId("g4pe_boundary", 1));
    expect(first).not.toBe(createPlatformAccessAuditId("g4pe_boundary", 2));
  });
});
