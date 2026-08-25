import { describe, expect, it, vi } from "vitest";

import { createHttpProjectGateway } from "./ProjectGateway";

describe("HTTP Project gateway", () => {
  it("BDD-PROJ-002 accepts a validated current Project projection", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: "current",
            slug: "wisemoney",
            purpose: {
              fr: "Partager un retour sur WiseMoney.",
              en: "Share feedback about WiseMoney.",
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const gateway = createHttpProjectGateway("https://feedback-api.example/", fetcher);

    await expect(gateway.resolve("wisemoney")).resolves.toEqual({
      status: "current",
      slug: "wisemoney",
      purpose: {
        fr: "Partager un retour sur WiseMoney.",
        en: "Share feedback about WiseMoney.",
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://feedback-api.example/v1/projects/wisemoney",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });

  it("BDD-PROJ-003 validates redirects and fails closed", async () => {
    const responses = [
      new Response(JSON.stringify({ status: "redirect", canonicalSlug: "wisemoney" }), {
        status: 200,
      }),
      new Response(JSON.stringify({ status: "current", slug: "../secret" }), {
        status: 200,
      }),
      new Response(JSON.stringify({ error: "ERR-PROJECT-UNAVAILABLE" }), {
        status: 404,
      }),
    ];
    const gateway = createHttpProjectGateway(
      "https://feedback-api.example",
      vi.fn(() =>
        Promise.resolve(responses.shift() ?? new Response(null, { status: 503 })),
      ),
    );

    await expect(gateway.resolve("wisemoney-legacy")).resolves.toEqual({
      status: "redirect",
      canonicalSlug: "wisemoney",
    });
    await expect(gateway.resolve("wisemoney")).resolves.toEqual({
      status: "unavailable",
    });
    await expect(gateway.resolve("unknown")).resolves.toEqual({
      status: "unavailable",
    });
  });
});
