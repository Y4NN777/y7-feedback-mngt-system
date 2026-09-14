import { describe, expect, it } from "vitest";

import { resolveApplicationRoute } from "./ApplicationRoute";

describe("application route descriptors", () => {
  it.each([
    ["/", { kind: "root" }],
    ["/retrieve", { kind: "retrieve" }],
    ["/manage", { kind: "administration" }],
    ["/manage/sources", { kind: "sources" }],
    ["/workbench", { kind: "workbench" }],
    ["/intelligence", { kind: "intelligence" }],
    ["/platform/access", { kind: "platform-access" }],
    ["/wise-money", { kind: "project", slug: "wise-money" }],
    ["/manage/unknown", { kind: "root" }],
    ["/INVALID", { kind: "root" }],
  ] as const)("resolves %s with exact routes before project slugs", (path, route) => {
    expect(resolveApplicationRoute(path)).toEqual(route);
  });
});
