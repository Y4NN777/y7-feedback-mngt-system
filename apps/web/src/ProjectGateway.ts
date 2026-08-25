import type { Locale } from "@y7-feedback/domain";

export type ProjectRouteResolution =
  | {
      readonly status: "current";
      readonly slug: string;
      readonly purpose: Readonly<Record<Locale, string>>;
    }
  | { readonly status: "redirect"; readonly canonicalSlug: string }
  | { readonly status: "unavailable" };

export interface ProjectGateway {
  resolve(slug: string): Promise<ProjectRouteResolution>;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function endpoint(value: string): URL {
  try {
    const parsed = new URL(value.endsWith("/") ? value : `${value}/`);
    const local =
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if (parsed.protocol !== "https:" && !local) throw new Error();
    return parsed;
  } catch {
    throw new Error("PROJECT_ENDPOINT_INVALID");
  }
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 300;
}

function parse(value: unknown): ProjectRouteResolution {
  if (!isObject(value)) return { status: "unavailable" };
  if (
    value.status === "redirect" &&
    typeof value.canonicalSlug === "string" &&
    slugPattern.test(value.canonicalSlug)
  ) {
    return { status: "redirect", canonicalSlug: value.canonicalSlug };
  }
  if (
    value.status === "current" &&
    typeof value.slug === "string" &&
    slugPattern.test(value.slug) &&
    isObject(value.purpose) &&
    safeText(value.purpose.fr) &&
    safeText(value.purpose.en)
  ) {
    return {
      status: "current",
      slug: value.slug,
      purpose: { fr: value.purpose.fr, en: value.purpose.en },
    };
  }
  return { status: "unavailable" };
}

export function createHttpProjectGateway(
  rawEndpoint: string,
  fetcher: Fetcher = globalThis.fetch,
): ProjectGateway {
  const base = endpoint(rawEndpoint);
  return {
    async resolve(slug) {
      if (!slugPattern.test(slug)) return { status: "unavailable" };
      try {
        const response = await fetcher(
          new URL(`v1/projects/${encodeURIComponent(slug)}`, base).toString(),
          { method: "GET", cache: "no-store", credentials: "omit" },
        );
        if (response.status !== 200) return { status: "unavailable" };
        return parse((await response.json()) as unknown);
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}
