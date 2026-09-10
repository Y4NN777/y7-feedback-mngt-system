import { describe, expect, it } from "vitest";

import { collectSloEvidenceSamples } from "./slo-g5-evidence";

describe("G5 SLO evidence boundary", () => {
  it("BDD-SLO-206 accepts only finite non-negative operational durations", () => {
    expect(
      collectSloEvidenceSamples({
        feedbackCommitSamplesMs: [10],
        attachmentProcessingSamplesMs: [20],
        criticalApiSamplesMs: [30],
        dashboardSamplesMs: [40],
        notificationVisibilitySamplesMs: [50],
        emailHandoffSamplesMs: [60],
      }),
    ).toEqual([
      ["critical_api_ms", 30],
      ["feedback_commit_ms", 10],
      ["dashboard_ms", 40],
      ["attachment_processing_ms", 20],
      ["notification_visibility_ms", 50],
      ["email_handoff_ms", 60],
    ]);
  });

  it.each([
    null,
    {},
    { criticalApiSamplesMs: [Number.NaN] },
    { criticalApiSamplesMs: [-1] },
    { criticalApiSamplesMs: ["1"] },
  ])("BDD-SLO-207 rejects missing or unsafe evidence %#", (candidate) => {
    expect(() => collectSloEvidenceSamples(candidate)).toThrow(
      "SLO_G5_EVIDENCE_INVALID",
    );
  });
});
