import { describe, expect, it } from "vitest";

import { isNondisclosingProviderDenial } from "./production-denial-evidence.js";

describe("Production provider denial evidence", () => {
  it.each([400, 401, 403, 404])(
    "BDD-REL-434 accepts a typed non-disclosing denial returned with HTTP %s",
    async (status) => {
      await expect(
        isNondisclosingProviderDenial(
          Response.json({ error: "ERR-SOURCE-DENIED" }, { status }),
        ),
      ).resolves.toBe(true);
    },
  );

  it("BDD-REL-434 rejects untyped, successful, and server-error responses", async () => {
    await expect(
      isNondisclosingProviderDenial(
        Response.json({ error: "denied" }, { status: 404 }),
      ),
    ).resolves.toBe(false);
    await expect(
      isNondisclosingProviderDenial(
        Response.json({ error: "ERR-SOURCE-DENIED" }, { status: 200 }),
      ),
    ).resolves.toBe(false);
    await expect(
      isNondisclosingProviderDenial(
        Response.json({ error: "ERR-SOURCE-DENIED" }, { status: 500 }),
      ),
    ).resolves.toBe(false);
  });
});
