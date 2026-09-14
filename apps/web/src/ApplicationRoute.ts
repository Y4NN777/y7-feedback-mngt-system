export type ApplicationRoute =
  | { readonly kind: "root" }
  | { readonly kind: "retrieve" }
  | { readonly kind: "administration" }
  | { readonly kind: "sources" }
  | { readonly kind: "workbench" }
  | { readonly kind: "intelligence" }
  | { readonly kind: "platform-access" }
  | { readonly kind: "project"; readonly slug: string };

const exactRoutes = new Map<string, ApplicationRoute>([
  ["/", { kind: "root" }],
  ["/retrieve", { kind: "retrieve" }],
  ["/manage", { kind: "administration" }],
  ["/manage/sources", { kind: "sources" }],
  ["/workbench", { kind: "workbench" }],
  ["/intelligence", { kind: "intelligence" }],
  ["/platform/access", { kind: "platform-access" }],
]);
const projectSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function resolveApplicationRoute(pathname: string): ApplicationRoute {
  const exactRoute = exactRoutes.get(pathname);
  if (exactRoute) return exactRoute;

  const candidateSlug = pathname.slice(1);
  return projectSlugPattern.test(candidateSlug)
    ? { kind: "project", slug: candidateSlug }
    : { kind: "root" };
}
