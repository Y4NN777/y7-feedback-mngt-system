import { describe, expect, it, vi } from "vitest";

import {
  createNotificationInvalidation,
  type NotificationRealtimePort,
} from "./NotificationInvalidation";

describe("Appwrite notification invalidation", () => {
  it("BDD-NOT-REALTIME-001 subscribes to the permission-filtered signal rows", async () => {
    const unsubscribe = vi.fn(() => Promise.resolve());
    const subscribe = vi.fn<NotificationRealtimePort["subscribe"]>(() =>
      Promise.resolve({ unsubscribe }),
    );
    const invalidate = vi.fn();
    const close = await createNotificationInvalidation({ subscribe }).subscribe(
      { databaseId: "feedback", tableId: "notification_signals" },
      invalidate,
    );
    expect(subscribe).toHaveBeenCalledWith(
      "tablesdb.feedback.tables.notification_signals.rows",
      invalidate,
    );
    subscribe.mock.calls[0]?.[1]();
    expect(invalidate).toHaveBeenCalledOnce();
    await close();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
