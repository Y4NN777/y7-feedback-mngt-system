import type { SourceProvider } from "./source-connection.js";

export type RepositoryVisibility = "public" | "private" | "internal";

export interface ProviderReleaseMetadata {
  readonly id: string;
  readonly tag: string;
  readonly name: string;
  readonly publishedAt: string;
  readonly webUrl: string;
}

export interface ProviderRepositoryMetadata {
  readonly provider: SourceProvider;
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly visibility: RepositoryVisibility;
  readonly webUrl: string;
  readonly defaultBranch: string;
  readonly releases: readonly ProviderReleaseMetadata[];
}

export interface ImportedRepositoryMetadata {
  readonly connectionId: string;
  readonly provider: SourceProvider;
  readonly repositoryId: string;
  readonly name: string;
  readonly owner: string;
  readonly visibility: RepositoryVisibility;
  readonly webUrl: string;
  readonly defaultBranch: string;
  readonly observedAt: string;
  readonly releases: readonly {
    readonly providerReleaseId: string;
    readonly tag: string;
    readonly name: string;
    readonly publishedAt: string;
    readonly webUrl: string;
    readonly observedAt: string;
  }[];
}

export class SourceImportError extends Error {
  constructor() {
    super("SOURCE_IMPORT_INVALID");
    this.name = "SourceImportError";
  }
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const slug = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== "string") throw new SourceImportError();
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new SourceImportError();
  return normalized;
}

function timestamp(value: unknown): string {
  const normalized = text(value, 40);
  if (
    !Number.isFinite(Date.parse(normalized)) ||
    new Date(Date.parse(normalized)).toISOString() !== normalized
  ) {
    throw new SourceImportError();
  }
  return normalized;
}

function httpsUrl(value: unknown): string {
  const normalized = text(value, 2_000);
  try {
    const url = new URL(normalized);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.toString() !== normalized
    ) {
      throw new SourceImportError();
    }
    return normalized;
  } catch {
    throw new SourceImportError();
  }
}

export function importRepositoryMetadata(input: unknown): ImportedRepositoryMetadata {
  if (
    !object(input) ||
    Object.keys(input).sort().join(",") !== "connectionId,observedAt,repository" ||
    !object(input.repository) ||
    Object.keys(input.repository).sort().join(",") !==
      "defaultBranch,id,name,owner,provider,releases,visibility,webUrl" ||
    (input.repository.provider !== "github" &&
      input.repository.provider !== "gitlab") ||
    (input.repository.visibility !== "public" &&
      input.repository.visibility !== "private" &&
      input.repository.visibility !== "internal") ||
    !Array.isArray(input.repository.releases) ||
    input.repository.releases.length > 100
  ) {
    throw new SourceImportError();
  }
  const connectionId = text(input.connectionId, 36);
  const repositoryId = text(input.repository.id, 36);
  if (!identifier.test(connectionId) || !identifier.test(repositoryId)) {
    throw new SourceImportError();
  }
  const observedAt = timestamp(input.observedAt);
  const seen = new Set<string>();
  const releases = input.repository.releases.map((release) => {
    if (
      !object(release) ||
      Object.keys(release).sort().join(",") !== "id,name,publishedAt,tag,webUrl"
    ) {
      throw new SourceImportError();
    }
    const providerReleaseId = text(release.id, 200);
    if (seen.has(providerReleaseId)) throw new SourceImportError();
    seen.add(providerReleaseId);
    return {
      providerReleaseId,
      tag: text(release.tag, 200),
      name: text(release.name, 500),
      publishedAt: timestamp(release.publishedAt),
      webUrl: httpsUrl(release.webUrl),
      observedAt,
    };
  });
  return {
    connectionId,
    provider: input.repository.provider,
    repositoryId,
    name: text(input.repository.name, 500),
    owner: text(input.repository.owner, 500),
    visibility: input.repository.visibility,
    webUrl: httpsUrl(input.repository.webUrl),
    defaultBranch: text(input.repository.defaultBranch, 200),
    observedAt,
    releases,
  };
}

export function createProjectBadge(input: {
  readonly publicOrigin: string;
  readonly projectSlug: string;
  readonly label: string;
}): { readonly destination: string; readonly markdown: string } {
  try {
    const origin = new URL(input.publicOrigin);
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      !slug.test(input.projectSlug) ||
      text(input.label, 60) !== "Feedback"
    ) {
      throw new Error("SOURCE_BADGE_INVALID");
    }
    const destination = new URL(input.projectSlug, origin).toString();
    return {
      destination,
      markdown: `[![Feedback](https://img.shields.io/badge/Y7-Feedback-5b5bd6)](${destination})`,
    };
  } catch {
    throw new Error("SOURCE_BADGE_INVALID");
  }
}
