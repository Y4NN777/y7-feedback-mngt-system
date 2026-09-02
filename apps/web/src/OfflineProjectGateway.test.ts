import { describe, expect, it, vi } from "vitest";

import { createOfflineProjectGateway } from "./OfflineProjectGateway";
import type { OfflineScope } from "./OfflineStore";

const resolution = {
  status: "current" as const,
  slug: "wisemoney",
  purpose: { fr: "Avis WiseMoney", en: "WiseMoney feedback" },
};

describe("offline public Project projection", () => {
  it("BDD-OFF-106 stores a bounded public projection after authoritative resolution", async () => {
    const saveProjection = vi.fn(
      (
        _scope: OfflineScope,
        _id: string,
        _payload: Readonly<Record<string, unknown>>,
      ) => {
        void _scope;
        void _id;
        void _payload;
        return Promise.resolve();
      },
    );
    const gateway = createOfflineProjectGateway(
      { resolve: () => Promise.resolve(resolution) },
      { saveProjection, loadProjection: () => Promise.resolve(null) },
      "preview",
    );
    await expect(gateway.resolve("wisemoney")).resolves.toEqual(resolution);
    expect(saveProjection).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "preview", projectId: "wisemoney" }),
      "public-project",
      resolution,
    );
  });

  it("BDD-OFF-107 uses only a valid same-scope projection during an outage", async () => {
    const loadProjection = vi.fn(() => Promise.resolve({ payload: { ...resolution } }));
    const gateway = createOfflineProjectGateway(
      { resolve: () => Promise.resolve({ status: "unavailable" }) },
      { saveProjection: () => Promise.resolve(), loadProjection },
      "production",
    );
    await expect(gateway.resolve("wisemoney")).resolves.toEqual(resolution);
    expect(loadProjection).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "production", projectId: "wisemoney" }),
      "public-project",
    );
  });

  it("BDD-OFF-108 fails closed for malformed cached projections", async () => {
    for (const payload of [
      { status: "current" },
      { status: "current", slug: "wisemoney", purpose: [] },
    ]) {
      const gateway = createOfflineProjectGateway(
        { resolve: () => Promise.resolve({ status: "unavailable" }) },
        {
          saveProjection: () => Promise.resolve(),
          loadProjection: () => Promise.resolve({ payload }),
        },
        "preview",
      );
      await expect(gateway.resolve("wisemoney")).resolves.toEqual({
        status: "unavailable",
      });
    }
  });

  it("BDD-OFF-109 preserves authoritative results when local persistence fails", async () => {
    const current = createOfflineProjectGateway(
      { resolve: () => Promise.resolve(resolution) },
      {
        saveProjection: () => Promise.reject(new Error("quota")),
        loadProjection: () => Promise.resolve(null),
      },
      "preview",
    );
    await expect(current.resolve("wisemoney")).resolves.toEqual(resolution);
    const redirect = createOfflineProjectGateway(
      {
        resolve: () =>
          Promise.resolve({
            status: "redirect" as const,
            canonicalSlug: "wisemoney",
          }),
      },
      {
        saveProjection: () => Promise.resolve(),
        loadProjection: () => Promise.reject(new Error("unavailable")),
      },
      "preview",
    );
    await expect(redirect.resolve("wisemoney-old")).resolves.toEqual({
      status: "redirect",
      canonicalSlug: "wisemoney",
    });
    const unavailable = createOfflineProjectGateway(
      { resolve: () => Promise.resolve({ status: "unavailable" }) },
      {
        saveProjection: () => Promise.resolve(),
        loadProjection: () => Promise.reject(new Error("unavailable")),
      },
      "preview",
    );
    await expect(unavailable.resolve("wisemoney")).resolves.toEqual({
      status: "unavailable",
    });
  });
});
