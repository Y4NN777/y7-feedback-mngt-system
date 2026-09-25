import { describe, expect, it, vi } from "vitest";

import {
  createNotificationInvalidation,
  type NotificationRealtimePort,
} from "./NotificationInvalidation";

describe("Appwrite notification invalidation", () => {
  it("BDD-NOT-REALTIME-001 subscribes to the permission-filtered signal rows", async () => {
    const unsubscribe = vi.fn(() => Promise.resolve());
    const connected = vi.fn();
    const disconnected = vi.fn();
    const subscribe = vi.fn<NotificationRealtimePort["subscribe"]>(() =>
      Promise.resolve({ unsubscribe }),
    );
    const invalidate = vi.fn();
    const close = await createNotificationInvalidation({ subscribe }).subscribe(
      { databaseId: "feedback", tableId: "notification_signals" },
      { connected, disconnected, invalidate },
    );
    expect(subscribe).toHaveBeenCalledWith(
      "tablesdb.feedback.tables.notification_signals.rows",
      { connected, disconnected, invalidate },
    );
    subscribe.mock.calls[0]?.[1].connected();
    subscribe.mock.calls[0]?.[1].invalidate();
    subscribe.mock.calls[0]?.[1].disconnected();
    expect(connected).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledOnce();
    expect(disconnected).toHaveBeenCalledOnce();
    await close();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
