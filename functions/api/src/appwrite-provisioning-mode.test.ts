import { describe, expect, it } from "vitest";

import { resolveAppwriteProvisioningMode } from "./appwrite-provisioning-mode";

describe("Appwrite provisioning mode", () => {
  it("BDD-DEL-ENV-001 keeps Preview fixtures enabled", () => {
    expect(resolveAppwriteProvisioningMode("preview", false)).toEqual({
      seedFixtures: true,
    });
  });

  it("BDD-DEL-ENV-001 permits an explicitly authorized Production schema without fixtures", () => {
    expect(resolveAppwriteProvisioningMode("production", true)).toEqual({
      seedFixtures: false,
    });
  });

  it("BDD-DEL-ENV-001 fails closed when Production authorization is absent", () => {
    expect(() => resolveAppwriteProvisioningMode("production", false)).toThrow(
      "APPWRITE_PROVISION_PRODUCTION_AUTHORIZATION_REQUIRED",
    );
  });

  it("BDD-DEL-ENV-001 refuses development infrastructure mutation", () => {
    expect(() => resolveAppwriteProvisioningMode("development", true)).toThrow(
      "APPWRITE_PROVISION_ENVIRONMENT_INVALID",
    );
  });
});
