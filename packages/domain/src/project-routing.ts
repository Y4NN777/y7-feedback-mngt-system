import { DomainPolicyError, type Project } from "./policy.js";

interface RegisteredProject {
  readonly project: Project;
  currentSlug: string;
}

export type ProjectResolution =
  | { readonly kind: "current"; readonly project: Project; readonly slug: string }
  | {
      readonly kind: "redirect";
      readonly project: Project;
      readonly canonicalSlug: string;
    }
  | { readonly kind: "unavailable" };

export interface SlugRegistry {
  create(project: Project, slug: string): void;
  rename(projectId: string, slug: string): void;
  resolve(slug: string): ProjectResolution;
  resolveForIntake(slug: string): ProjectResolution;
}

const systemSlugs = new Set(["api", "assets", "manage", "retrieve"]);
const validSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function createSlugRegistry(): SlugRegistry {
  const reservations = new Map<string, string>();
  const projects = new Map<string, RegisteredProject>();

  function assertClaimable(slug: string, projectId: string): void {
    if (!validSlug.test(slug)) {
      throw new DomainPolicyError("SLUG_INVALID");
    }
    const owner = reservations.get(slug);
    if (systemSlugs.has(slug) || (owner !== undefined && owner !== projectId)) {
      throw new DomainPolicyError("SLUG_RESERVED");
    }
  }

  function resolve(slug: string): ProjectResolution {
    const projectId = reservations.get(slug);
    const registered = projectId ? projects.get(projectId) : undefined;
    if (!registered) {
      return { kind: "unavailable" };
    }
    if (registered.currentSlug === slug) {
      return { kind: "current", project: registered.project, slug };
    }
    return {
      kind: "redirect",
      project: registered.project,
      canonicalSlug: registered.currentSlug,
    };
  }

  return {
    create(project, slug) {
      if (projects.has(project.id)) {
        throw new DomainPolicyError("PROJECT_EXISTS");
      }
      assertClaimable(slug, project.id);
      reservations.set(slug, project.id);
      projects.set(project.id, { project, currentSlug: slug });
    },
    rename(projectId, slug) {
      const registered = projects.get(projectId);
      if (!registered) {
        throw new DomainPolicyError("PROJECT_NOT_FOUND");
      }
      assertClaimable(slug, projectId);
      reservations.set(slug, projectId);
      registered.currentSlug = slug;
    },
    resolve,
    resolveForIntake(slug) {
      const resolution = resolve(slug);
      if (resolution.kind === "unavailable" || !resolution.project.active) {
        return { kind: "unavailable" };
      }
      return resolution;
    },
  };
}
