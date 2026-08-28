import { describe, expect, it } from "vitest";

import {
  createProjectBadge,
  importRepositoryMetadata,
  SourceImportError,
} from "./source-import";

const observedAt = "2026-08-28T16:00:00.000Z";

describe("source repository import policy", () => {
  it("BDD-SRC-201 imports only metadata and releases with provider provenance", () => {
    expect(
      importRepositoryMetadata({
        connectionId: "connection_1",
        repository: {
          provider: "github",
          id: "1329343404",
          name: "y7-feedback-mngt-system",
          owner: "Y4NN777",
          visibility: "private",
          webUrl: "https://github.com/Y4NN777/y7-feedback-mngt-system",
          defaultBranch: "main",
          releases: [
            {
              id: "release_1",
              tag: "v1.0.0",
              name: "First release",
              publishedAt: "2026-08-27T12:00:00.000Z",
              webUrl:
                "https://github.com/Y4NN777/y7-feedback-mngt-system/releases/tag/v1.0.0",
            },
          ],
        },
        observedAt,
      }),
    ).toEqual({
      connectionId: "connection_1",
      provider: "github",
      repositoryId: "1329343404",
      name: "y7-feedback-mngt-system",
      owner: "Y4NN777",
      visibility: "private",
      webUrl: "https://github.com/Y4NN777/y7-feedback-mngt-system",
      defaultBranch: "main",
      observedAt,
      releases: [
        {
          providerReleaseId: "release_1",
          tag: "v1.0.0",
          name: "First release",
          publishedAt: "2026-08-27T12:00:00.000Z",
          webUrl:
            "https://github.com/Y4NN777/y7-feedback-mngt-system/releases/tag/v1.0.0",
          observedAt,
        },
      ],
    });
  });

  it("BDD-SRC-202 rejects executable URLs, duplicate releases and file-shaped data", () => {
    const valid = {
      connectionId: "connection_1",
      repository: {
        provider: "gitlab" as const,
        id: "83836910",
        name: "feedback",
        owner: "team",
        visibility: "internal" as const,
        webUrl: "https://gitlab.com/team/feedback",
        defaultBranch: "main",
        releases: [],
      },
      observedAt,
    };
    for (const input of [
      { ...valid, repository: { ...valid.repository, webUrl: "javascript:alert(1)" } },
      {
        ...valid,
        repository: { ...valid.repository, webUrl: "https://user@gitlab.com/team" },
      },
      {
        ...valid,
        repository: {
          ...valid.repository,
          webUrl: "https://user:password@gitlab.com/team",
        },
      },
      {
        ...valid,
        repository: { ...valid.repository, webUrl: "https://gitlab.com/team#code" },
      },
      { ...valid, repository: { ...valid.repository, webUrl: "https://gitlab.com" } },
      { ...valid, observedAt: "not-a-date" },
      { ...valid, connectionId: "invalid connection" },
      { ...valid, repository: { ...valid.repository, name: 7 } },
      { ...valid, repository: { ...valid.repository, name: " " } },
      { ...valid, repository: { ...valid.repository, name: "x".repeat(501) } },
      {
        ...valid,
        repository: {
          ...valid.repository,
          releases: [
            {
              id: "release_1",
              tag: "v1",
              name: "One",
              publishedAt: observedAt,
              webUrl: "https://gitlab.com/team/feedback/-/releases/v1",
            },
            {
              id: "release_1",
              tag: "v2",
              name: "Two",
              publishedAt: observedAt,
              webUrl: "https://gitlab.com/team/feedback/-/releases/v2",
            },
          ],
        },
      },
      {
        ...valid,
        repository: {
          ...valid.repository,
          releases: [
            {
              id: "release_1",
              tag: "v1",
              name: "One",
              publishedAt: observedAt,
              webUrl: "https://gitlab.com/team/feedback/-/releases/v1",
              body: "must not be imported",
            },
          ],
        },
      },
      {
        ...valid,
        repository: { ...valid.repository, files: [{ path: ".env", content: "x" }] },
      },
    ]) {
      expect(() =>
        importRepositoryMetadata(
          input as Parameters<typeof importRepositoryMetadata>[0],
        ),
      ).toThrow(SourceImportError);
    }
  });

  it("BDD-SRC-203 derives a copyable badge from the current Project slug", () => {
    expect(
      createProjectBadge({
        publicOrigin: "https://feedback.y7labs.dev/",
        projectSlug: "wise-money",
        label: "Feedback",
      }),
    ).toEqual({
      destination: "https://feedback.y7labs.dev/p/wise-money",
      markdown:
        "[![Feedback](https://img.shields.io/badge/Y7-Feedback-5b5bd6)](https://feedback.y7labs.dev/p/wise-money)",
    });
    expect(() =>
      createProjectBadge({
        publicOrigin: "https://feedback.y7labs.dev/",
        projectSlug: "../admin",
        label: "Feedback",
      }),
    ).toThrow("SOURCE_BADGE_INVALID");
  });
});
