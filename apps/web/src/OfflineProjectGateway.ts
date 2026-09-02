import type { ApplicationEnvironment } from "@y7-feedback/config/public";

import { offlineIntakeScope } from "./OfflineIntake";
import type { OfflineScope } from "./OfflineStore";
import type { ProjectGateway, ProjectRouteResolution } from "./ProjectGateway";

interface OfflineProjectionStore {
  saveProjection(
    scope: OfflineScope,
    id: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
  loadProjection(
    scope: OfflineScope,
    id: string,
  ): Promise<{ readonly payload: Readonly<Record<string, unknown>> } | null>;
}

function project(value: unknown): ProjectRouteResolution | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Readonly<Record<string, unknown>>;
  const purpose = row.purpose;
  if (
    row.status !== "current" ||
    typeof row.slug !== "string" ||
    typeof purpose !== "object" ||
    purpose === null ||
    Array.isArray(purpose)
  )
    return null;
  const localized = purpose as Readonly<Record<string, unknown>>;
  if (typeof localized.fr !== "string" || typeof localized.en !== "string") return null;
  return {
    status: "current",
    slug: row.slug,
    purpose: { fr: localized.fr, en: localized.en },
  };
}

export function createOfflineProjectGateway(
  gateway: ProjectGateway,
  store: OfflineProjectionStore,
  environment: ApplicationEnvironment,
): ProjectGateway {
  return {
    async resolve(slug) {
      const scope = offlineIntakeScope(environment, slug);
      const remote = await gateway.resolve(slug);
      if (remote.status === "current") {
        try {
          await store.saveProjection(scope, "public-project", { ...remote });
        } catch {
          // The authoritative online projection remains usable when quota is full.
        }
        return remote;
      }
      if (remote.status === "redirect") return remote;
      try {
        const cached = await store.loadProjection(scope, "public-project");
        return project(cached?.payload) ?? remote;
      } catch {
        return remote;
      }
    },
  };
}
