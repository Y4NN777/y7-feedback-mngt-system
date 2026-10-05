import { describe, expect, it } from "vitest";

import {
  ProviderIssueError,
  classifyProviderStatus,
  issueDocument,
  issueMarker,
} from "./provider-issue";

const valid = {
  operationId: "operation_1",
  repository: { id: "123", owner: "Y4NN777", name: "feedback" },
  payload: {
    reference: "Y7-ABC123",
    protectedWorkspaceUrl: "https://feedback.example/workbench?feedbackId=feedback_1",
    feedbackType: "bug" as const,
    origin: "y7-feedback" as const,
  },
};

describe("Provider issue document", () => {
  it("BDD-ISSUE-PROVIDER-001 emits only the minimal allow-listed document", () => {
    expect(issueDocument(valid)).toEqual({
      title: "[Y7][bug] Y7-ABC123",
      marker: "<!-- y7-feedback-operation:operation_1 -->",
      body: [
        "<!-- y7-feedback-operation:operation_1 -->",
        "Y7 reference: Y7-ABC123",
        "Protected feedback: https://feedback.example/workbench?feedbackId=feedback_1",
        "",
        "Origin: y7-feedback",
      ].join("\n"),
    });
    expect(
      issueDocument({
        ...valid,
        payload: { ...valid.payload, reporterContent: "Approved details" },
      }).body,
    ).toContain("Reporter-approved content:\nApproved details");
  });

  it.each([
    { operationId: "bad id" },
    { repository: { ...valid.repository, id: "bad/id" } },
    { repository: { ...valid.repository, owner: "bad\u0000owner" } },
    { repository: { ...valid.repository, name: "" } },
    { payload: { ...valid.payload, reference: "bad reference" } },
    { payload: { ...valid.payload, feedbackType: "task" } },
    { payload: { ...valid.payload, origin: "foreign" } },
    { payload: { ...valid.payload, protectedWorkspaceUrl: "http://feedback.test" } },
    {
      payload: {
        ...valid.payload,
        protectedWorkspaceUrl: "https://user:pass@feedback.example/workbench",
      },
    },
    { payload: { ...valid.payload, protectedWorkspaceUrl: "not-a-url" } },
  ])("BDD-ISSUE-PROVIDER-002 fails closed for malformed input %#", (override) => {
    expect(() => issueDocument({ ...valid, ...override } as never)).toThrow(
      new ProviderIssueError("permanent"),
    );
  });

  it("BDD-ISSUE-PROVIDER-003 classifies bounded provider failures", () => {
    expect([408, 409, 425, 429, 500, 503].map(classifyProviderStatus)).toEqual(
      Array(6).fill("retryable"),
    );
    expect([400, 401, 403, 404, 422].map(classifyProviderStatus)).toEqual(
      Array(5).fill("permanent"),
    );
    expect(() => issueMarker("bad id")).toThrow(new ProviderIssueError("permanent"));
  });
});
