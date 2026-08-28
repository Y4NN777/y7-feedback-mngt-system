import { describe, expect, it } from "vitest";

import {
  WorkbenchPolicyError,
  filterWorkbenchInbox,
  validateWorkbenchFilter,
  validateWorkspaceClassification,
  type ActorAccess,
  type WorkbenchInboxItem,
} from "./index";

const owner: ActorAccess = {
  principalId: "owner_1",
  responsibility: "workspace_owner",
  workspaceIds: ["workspace_1"],
  projectIds: [],
};
const maintainer: ActorAccess = {
  principalId: "maintainer_1",
  responsibility: "project_maintainer",
  workspaceIds: ["workspace_1"],
  projectIds: ["project_1"],
};
const items: readonly WorkbenchInboxItem[] = [
  {
    feedbackId: "feedback_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    type: "bug",
    state: "received",
    acceptedAt: "2026-08-28T10:00:00.000Z",
    assignedPrincipalIds: ["maintainer_1"],
    deleted: false,
  },
  {
    feedbackId: "feedback_2",
    workspaceId: "workspace_1",
    projectId: "project_1",
    type: "suggestion",
    state: "awaiting_reporter",
    acceptedAt: "2026-08-28T11:00:00.000Z",
    assignedPrincipalIds: [],
    deleted: false,
  },
  {
    feedbackId: "feedback_sibling",
    workspaceId: "workspace_1",
    projectId: "project_2",
    type: "review",
    state: "resolved",
    acceptedAt: "2026-08-28T12:00:00.000Z",
    assignedPrincipalIds: ["maintainer_1"],
    deleted: false,
  },
  {
    feedbackId: "feedback_deleted",
    workspaceId: "workspace_1",
    projectId: "project_1",
    type: "bug",
    state: "closed",
    acceptedAt: "2026-08-28T13:00:00.000Z",
    assignedPrincipalIds: ["maintainer_1"],
    deleted: true,
  },
];

describe("Workbench inbox policy", () => {
  it("BDD-WORK-001 gives an Owner the scoped Project inbox with exact filters", () => {
    expect(
      filterWorkbenchInbox(items, owner, "workspace_1", "project_1", {
        types: ["suggestion"],
        states: ["awaiting_reporter"],
        assignment: "unassigned",
        acceptedFrom: "2026-08-28T10:30:00.000Z",
        acceptedTo: "2026-08-28T11:30:00.000Z",
      }).map((item) => item.feedbackId),
    ).toEqual(["feedback_2"]);
  });

  it("BDD-WORK-002 restricts a Maintainer to currently assigned visible Feedback", () => {
    expect(
      filterWorkbenchInbox(items, maintainer, "workspace_1", "project_1", {
        types: [],
        states: [],
        assignment: "all",
      }).map((item) => item.feedbackId),
    ).toEqual(["feedback_1"]);
    expect(
      filterWorkbenchInbox(
        items,
        { ...maintainer, projectIds: [] },
        "workspace_1",
        "project_1",
        {
          types: [],
          states: [],
          assignment: "all",
        },
      ),
    ).toEqual([]);
  });

  it("BDD-WORK-003 excludes sibling, cross-Workspace and deleted records", () => {
    expect(
      filterWorkbenchInbox(items, owner, "workspace_1", "project_1", {
        types: [],
        states: [],
        assignment: "all",
      }).map((item) => item.feedbackId),
    ).toEqual(["feedback_2", "feedback_1"]);
    expect(
      filterWorkbenchInbox(items, owner, "workspace_2", "project_1", {
        types: [],
        states: [],
        assignment: "all",
      }),
    ).toEqual([]);
  });

  it("BDD-WORK-004 rejects ambiguous filters and invalid classification", () => {
    for (const candidate of [
      null,
      [],
      { types: "bug", states: [], assignment: "all" },
      { types: ["bug", "bug"], states: [], assignment: "all" },
      { types: ["bug", "suggestion", "review", "bug"], states: [], assignment: "all" },
      { types: ["unknown"], states: [], assignment: "all" },
      { types: [], states: "received", assignment: "all" },
      { types: [], states: ["received", "received"], assignment: "all" },
      {
        types: [],
        states: [
          "received",
          "under_review",
          "awaiting_reporter",
          "resolved",
          "closed",
          "received",
        ],
        assignment: "all",
      },
      { types: [], states: ["unknown"], assignment: "all" },
      { types: [], states: [], assignment: "mine" },
      { types: [], states: [], assignment: "all", acceptedFrom: 1 },
      { types: [], states: [], assignment: "all", acceptedFrom: "not-a-date" },
      {
        types: [],
        states: [],
        assignment: "all",
        acceptedFrom: "2026-08-28T10:00:00Z",
      },
      {
        types: [],
        states: [],
        assignment: "all",
        acceptedFrom: "2026-08-29T00:00:00.000Z",
        acceptedTo: "2026-08-28T00:00:00.000Z",
      },
    ]) {
      expect(() => validateWorkbenchFilter(candidate)).toThrow(
        new WorkbenchPolicyError("ERR-WORK-FILTER-INVALID"),
      );
    }
    expect(validateWorkspaceClassification("  Performance / API  ")).toBe(
      "Performance / API",
    );
    expect(() => validateWorkspaceClassification("<script>alert(1)</script>")).toThrow(
      new WorkbenchPolicyError("ERR-WORK-CLASSIFICATION-INVALID"),
    );
    for (const value of [
      undefined,
      "",
      "x".repeat(121),
      "eval(value)",
      "bad\u0000value",
    ]) {
      expect(() => validateWorkspaceClassification(value)).toThrow(
        new WorkbenchPolicyError("ERR-WORK-CLASSIFICATION-INVALID"),
      );
    }
  });

  it("covers assignment and time-window exclusion branches", () => {
    expect(
      filterWorkbenchInbox(items, owner, "workspace_1", "project_1", {
        types: [],
        states: [],
        assignment: "assigned_to_me",
        acceptedFrom: "2026-08-28T10:30:00.000Z",
      }),
    ).toEqual([]);
    expect(
      filterWorkbenchInbox(items, owner, "workspace_1", "project_1", {
        types: [],
        states: [],
        assignment: "all",
        acceptedTo: "2026-08-28T09:00:00.000Z",
      }),
    ).toEqual([]);
  });
});
