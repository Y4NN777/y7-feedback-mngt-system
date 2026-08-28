import { describe, expect, it } from "vitest";

import {
  ProjectAdministrationError,
  validateProjectAdministrationCommand,
} from "./project-administration";

const configuration = {
  enabledTypes: ["bug", "suggestion", "review"] as const,
  contextDeclarations: [
    {
      name: "applicationVersion",
      type: "string" as const,
      purpose: "Reproduce the reported behavior",
    },
  ],
  reporterPurpose: {
    fr: "Vous recontacter au sujet de ce retour",
    en: "Contact you about this feedback",
  },
};

describe("Project administration commands", () => {
  it("BDD-ADMIN-001 validates and normalizes Project creation", () => {
    expect(
      validateProjectAdministrationCommand({
        kind: "create_project",
        operationId: "operation_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        slug: "wise-money",
        ...configuration,
      }),
    ).toEqual({
      kind: "create_project",
      operationId: "operation_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      slug: "wise-money",
      ...configuration,
    });
  });

  it("BDD-ADMIN-003 validates explicit configuration, slug, activation and assignment commands", () => {
    for (const command of [
      {
        kind: "configure_project" as const,
        operationId: "operation_2",
        workspaceId: "workspace_1",
        projectId: "project_1",
        ...configuration,
      },
      {
        kind: "rename_project" as const,
        operationId: "operation_3",
        workspaceId: "workspace_1",
        projectId: "project_1",
        slug: "wise-money-next",
      },
      {
        kind: "set_project_activation" as const,
        operationId: "operation_4",
        workspaceId: "workspace_1",
        projectId: "project_1",
        active: false,
      },
      {
        kind: "assign_maintainer" as const,
        operationId: "operation_5",
        workspaceId: "workspace_1",
        projectId: "project_1",
        maintainerId: "user_1",
      },
      {
        kind: "remove_maintainer" as const,
        operationId: "operation_6",
        workspaceId: "workspace_1",
        projectId: "project_1",
        maintainerId: "user_1",
      },
    ]) {
      expect(validateProjectAdministrationCommand(command)).toEqual(command);
    }
  });

  it("BDD-ADMIN-004 rejects malformed, duplicate, executable and oversized configuration", () => {
    const invalid = [
      { enabledTypes: ["bug", "bug"] },
      { enabledTypes: "bug" },
      { enabledTypes: ["unknown"] },
      { contextDeclarations: "version" },
      { contextDeclarations: [null] },
      {
        contextDeclarations: [{ name: 1, type: "string", purpose: "Valid purpose" }],
      },
      {
        contextDeclarations: [
          { name: "version", type: "object", purpose: "Valid purpose" },
        ],
      },
      {
        contextDeclarations: [{ name: "version", type: "string", purpose: 1 }],
      },
      {
        contextDeclarations: [
          { name: "version", type: "string", purpose: "javascript:alert(1)" },
        ],
      },
      { reporterPurpose: null },
      { reporterPurpose: { fr: 1, en: "Valid" } },
      { reporterPurpose: { fr: " ", en: "Valid" } },
      { reporterPurpose: { fr: "<script>alert(1)</script>", en: "Valid" } },
      { reporterPurpose: { fr: "x".repeat(301), en: "Valid" } },
    ];

    for (const override of invalid) {
      expect(() =>
        validateProjectAdministrationCommand({
          kind: "configure_project",
          operationId: "operation_2",
          workspaceId: "workspace_1",
          projectId: "project_1",
          ...configuration,
          ...override,
        }),
      ).toThrow(new ProjectAdministrationError("ERR-ADMIN-COMMAND-INVALID"));
    }
  });

  it("BDD-ADMIN-004 rejects malformed identifiers, reserved slugs and invalid command shapes", () => {
    for (const command of [
      null,
      [],
      {
        kind: "rename_project",
        operationId: "operation/1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        slug: "valid-slug",
      },
      {
        kind: "rename_project",
        operationId: "operation_1",
        workspaceId: "workspace/1",
        projectId: "project_1",
        slug: "valid-slug",
      },
      {
        kind: "rename_project",
        operationId: "operation_1",
        workspaceId: "workspace_1",
        projectId: "project/1",
        slug: "valid-slug",
      },
      {
        kind: "rename_project",
        operationId: "operation_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        slug: "api",
      },
      {
        kind: "rename_project",
        operationId: "operation_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        slug: "Bad-Slug",
      },
      {
        kind: "rename_project",
        operationId: "operation_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        slug: `a${"b".repeat(63)}`,
      },
      {
        kind: "set_project_activation",
        operationId: "operation_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        active: "false",
      },
      {
        kind: "assign_maintainer",
        operationId: "operation_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        maintainerId: "user/1",
      },
      {
        kind: "unknown",
        operationId: "operation_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
      },
    ]) {
      expect(() => validateProjectAdministrationCommand(command)).toThrow(
        new ProjectAdministrationError("ERR-ADMIN-COMMAND-INVALID"),
      );
    }
  });
});
