import type { ProjectFeedbackConfig } from "@y7-feedback/domain";

export interface PublicProject {
  readonly slug: string;
  readonly feedbackConfig: ProjectFeedbackConfig;
  readonly reporterPurpose: {
    readonly fr: string;
    readonly en: string;
  };
}

export interface PublicProjectReader {
  findBySlug(slug: string): Promise<PublicProject | null>;
  resolve(
    slug: string,
  ): Promise<
    | { readonly kind: "current"; readonly project: PublicProject }
    | { readonly kind: "redirect"; readonly canonicalSlug: string }
    | { readonly kind: "unavailable" }
  >;
}
