import { describe, expect, it } from "vitest";

import {
  initialNotificationPollingDelay,
  maximumNotificationPollingDelay,
  nextNotificationPollingDelay,
} from "./NotificationRefreshPolicy";

describe("notification refresh policy", () => {
  it("TASK-DX-009 resets fallback polling after an authoritative response", () => {
    expect(nextNotificationPollingDelay(40_000, "ok")).toBe(
      initialNotificationPollingDelay,
    );
  });

  it("TASK-DX-009 backs off retryable polling failures to a bounded interval", () => {
    expect(nextNotificationPollingDelay(5_000, "retryable")).toBe(10_000);
    expect(nextNotificationPollingDelay(40_000, "retryable")).toBe(
      maximumNotificationPollingDelay,
    );
    expect(
      nextNotificationPollingDelay(maximumNotificationPollingDelay, "retryable"),
    ).toBe(maximumNotificationPollingDelay);
  });
});
