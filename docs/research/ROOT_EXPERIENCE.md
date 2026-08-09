# Root Experience Study - Non-Normative

## Status

This note records observation and a recommendation for
`feedback.y7labs.studio/`. It is not a product decision, requirement, or
architecture choice. Only the validated rule that `/` must not automatically
publish a project catalog is normative.

Observed on 2026-08-09. Product interfaces evolve; the cited official material
is the evidence used for this pass.

## Observed Patterns

### Vercel

Vercel separates three contexts:

1. `vercel.com/` explains the platform and offers explicit product, resource,
   login, signup, and dashboard entry points. It does not behave as an automatic
   list of customer projects.
2. `/dashboard` is an authenticated product entry. Without a session it preserves
   the intended destination through login. Vercel documents that a user's
   default team is selected when entering `/dashboard`.
3. Inside the product, the team scope is selected before project management, and
   a selected project opens a project-specific dashboard. Direct project context
   is therefore preserved instead of forcing navigation through a public root.

Sources:

- [Vercel home page](https://vercel.com/)
- [Vercel dashboard entry](https://vercel.com/dashboard)
- [Vercel account and default-team behavior](https://vercel.com/docs/accounts)
- [Vercel projects overview](https://vercel.com/docs/projects)
- [Vercel team and project switcher](https://vercel.com/changelog/improved-experience-for-moving-between-your-teams-and-projects)

### Canny

Canny separates route accessibility from root-page discovery. Its documentation
states that a public board can remain reachable by its direct URL without being
shown on the portal home page. It also documents redirects after a board URL is
changed. This is relevant to Y7 Feedback's already validated non-catalog root and
historical project-slug redirects; Canny's public-board identity requirements are
not adopted.

Sources:

- [Canny public boards](https://help.canny.io/en/articles/3832293-public-boards)
- [Canny board settings and URL changes](https://help.canny.io/en/articles/4968514-board-settings)
- [Canny portal implementation options](https://help.canny.io/en/articles/12310866-options-for-implementing-canny)

### Jira Service Management

Jira Service Management distinguishes a general product/site entry from a
customer's context-specific help-center URL. Its portal-only customers must use
the specific help-center route rather than the product root. This reinforces the
value of preserving a direct project link for reporters, but Y7 Feedback does
not adopt Jira accounts, licensing, or portal hierarchy.

Source:

- [Jira Service Management customer access](https://support.atlassian.com/user-management/docs/manage-jira-service-management-customer-accounts/)

## Pattern Synthesis

The reusable pattern is separation by intent:

- a context-free root explains where the visitor is and offers safe next steps;
- an authenticated workspace entry serves operators and maintainers;
- a direct project route serves a reporter who already has project context;
- a direct feedback-retrieval route serves a reporter returning with a reference
  and access proof;
- lack of root discovery does not make a direct route inaccessible.

This pattern avoids two errors for Y7 Feedback: asking a reporter to choose among
unrelated projects, and turning the root into an accidental public customer
directory.

## Recommendation - Not Validated

Use `/` as a bilingual orientation page with three explicit intentions:

1. **Give feedback** - explain that the visitor should use the project-specific
   link supplied by the project; do not list or search all project slugs.
2. **Return to feedback** - provide the entry into reference-based retrieval,
   where access proof is still required.
3. **Manage feedback** - provide the entry for Workspace Owners and Project
   Maintainers, with authentication handled outside the public reporter flow.

Additional recommended behavior:

- explain briefly what Y7 Feedback is and distinguish it from the project being
  reviewed;
- keep French and English available;
- let a valid current or historical `/{project-slug}` route bypass `/` and retain
  project context;
- never expose project existence through root-page suggestions or a generated
  catalog;
- give an unknown route a neutral unavailable outcome rather than suggestions
  for other projects.

## Consequences

- **Product:** visitors without project context receive orientation, while
  reporters with a direct link reach the shortest relevant path.
- **Security and privacy:** the root does not become a workspace or project
  enumeration surface.
- **SaaS evolution:** workspace management and reporter intake can evolve
  independently without introducing custom domains or a marketplace.
- **Trade-off:** a reporter who loses both the project link and feedback reference
  cannot discover a project from `/`; projects remain responsible for providing
  their public feedback link.

## Decision Still Required

Accept, modify, or reject the recommendation above before converting any part of
it beyond the no-catalog rule into normative requirements.
