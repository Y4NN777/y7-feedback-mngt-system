import { describe, expect, it } from "vitest";

import type { ProjectAdministrationCommand } from "./project-administration";
import {
  ProjectAdministrationStateError,
  planProjectAdministrationMutation,
  type ProjectAdministrationState,
} from "./project-administration-state";

const configuration = {
  enabledTypes: ["bug"] as const,
  contextDeclarations: [] as const,
  reporterPurpose: { fr: "But français", en: "English purpose" },
};
const state: ProjectAdministrationState = {
  projectId: "project_1",
  workspaceId: "workspace_1",
  slug: "current-slug",
  active: true,
  ...configuration,
};
const identity = {
  operationId: "operation_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
};

describe("Project administration state policy", () => {
  it("BDD-ADMIN-003 plans a complete configuration replacement", () => {
    const command: ProjectAdministrationCommand = {
      kind: "configure_project",
      ...identity,
      enabledTypes: ["bug", "review"],
      contextDeclarations: [{ name: "version", type: "string", purpose: "Reproduce" }],
      reporterPurpose: { fr: "Nouveau but", en: "New purpose" },
    };

    expect(planProjectAdministrationMutation(command, state)).toEqual({
      kind: "configure_project",
      projectPatch: {
        enabledTypes: ["bug", "review"],
        contextDeclarations: [
          { name: "version", type: "string", purpose: "Reproduce" },
        ],
        reporterPurpose: { fr: "Nouveau but", en: "New purpose" },
      },
    });
  });

  it("BDD-ADMIN-006 preserves the previous slug while making the new slug canonical", () => {
    expect(
      planProjectAdministrationMutation(
        { kind: "rename_project", ...identity, slug: "new-slug" },
        state,
      ),
    ).toEqual({
      kind: "rename_project",
      previousSlug: "current-slug",
      slug: "new-slug",
    });
  });

  it("BDD-ADMIN-007 plans exactly one activation state change", () => {
    expect(
      planProjectAdministrationMutation(
        { kind: "set_project_activation", ...identity, active: false },
        state,
      ),
    ).toEqual({ kind: "set_project_activation", active: false });
  });

  it("BDD-ADMIN-008 plans assignment and immediate removal", () => {
    expect(
      planProjectAdministrationMutation(
        {
          kind: "assign_maintainer",
          ...identity,
          maintainerId: "maintainer_1",
        },
        state,
        { eligible: true, active: false },
      ),
    ).toEqual({
      kind: "assign_maintainer",
      maintainerId: "maintainer_1",
      active: true,
    });
    expect(
      planProjectAdministrationMutation(
        {
          kind: "remove_maintainer",
          ...identity,
          maintainerId: "maintainer_1",
        },
        state,
        { eligible: true, active: true },
      ),
    ).toEqual({
      kind: "remove_maintainer",
      maintainerId: "maintainer_1",
      active: false,
    });
  });

  it("BDD-ADMIN-004 rejects no-op configuration and leaves state unchanged", () => {
    expect(() =>
      planProjectAdministrationMutation(
        { kind: "configure_project", ...identity, ...configuration },
        state,
      ),
    ).toThrow(new ProjectAdministrationStateError("ERR-ADMIN-NO-OP"));
  });

  it("BDD-ADMIN-007 rejects no-op slug, activation and assignment transitions", () => {
    for (const [command, assignment] of [
      [{ kind: "rename_project", ...identity, slug: "current-slug" }, undefined],
      [{ kind: "set_project_activation", ...identity, active: true }, undefined],
      [
        { kind: "assign_maintainer", ...identity, maintainerId: "maintainer_1" },
        { eligible: true, active: true },
      ],
      [
        { kind: "remove_maintainer", ...identity, maintainerId: "maintainer_1" },
        { eligible: true, active: false },
      ],
    ] as const) {
      expect(() =>
        planProjectAdministrationMutation(
          command as ProjectAdministrationCommand,
          state,
          assignment,
        ),
      ).toThrow(new ProjectAdministrationStateError("ERR-ADMIN-NO-OP"));
    }
  });

  it("BDD-ADMIN-002 rejects cross-scope state and creation in the mutation policy", () => {
    for (const candidate of [
      { ...state, projectId: "project_2" },
      { ...state, workspaceId: "workspace_2" },
    ]) {
      expect(() =>
        planProjectAdministrationMutation(
          { kind: "rename_project", ...identity, slug: "new-slug" },
          candidate,
        ),
      ).toThrow(new ProjectAdministrationStateError("ERR-ADMIN-SCOPE-DENIED"));
    }
    expect(() =>
      planProjectAdministrationMutation(
        {
          kind: "create_project",
          ...identity,
          slug: "new-slug",
          ...configuration,
        },
        state,
      ),
    ).toThrow(new ProjectAdministrationStateError("ERR-ADMIN-STATE-INVALID"));
  });

  it("BDD-ADMIN-008 rejects missing or ineligible Maintainer authority", () => {
    const command: ProjectAdministrationCommand = {
      kind: "assign_maintainer",
      ...identity,
      maintainerId: "maintainer_1",
    };
    for (const assignment of [undefined, { eligible: false, active: false }]) {
      expect(() =>
        planProjectAdministrationMutation(command, state, assignment),
      ).toThrow(new ProjectAdministrationStateError("ERR-ADMIN-MAINTAINER-INELIGIBLE"));
    }
  });
});
