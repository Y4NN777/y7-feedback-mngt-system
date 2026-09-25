import { Channel, Client, Realtime } from "appwrite";

export interface NotificationRealtimePort {
  subscribe(
    channel: string,
    observer: NotificationInvalidationObserver,
  ): Promise<{ readonly unsubscribe: () => Promise<void> }>;
}

export interface NotificationInvalidationObserver {
  readonly connected: () => void;
  readonly disconnected: () => void;
  readonly invalidate: () => void;
}

export interface NotificationInvalidation {
  subscribe(
    target: { readonly databaseId: string; readonly tableId: string },
    observer: NotificationInvalidationObserver,
  ): Promise<() => Promise<void>>;
}

export function createNotificationInvalidation(
  realtime: NotificationRealtimePort,
): NotificationInvalidation {
  return {
    async subscribe(target, observer) {
      const channel = Channel.tablesdb(target.databaseId)
        .table(target.tableId)
        .row()
        .toString();
      const subscription = await realtime.subscribe(channel, observer);
      return () => subscription.unsubscribe();
    },
  };
}

/* v8 ignore start -- browser SDK composition is verified by deployed Realtime evidence */
export function createAppwriteNotificationInvalidation(
  endpoint: string,
  projectId: string,
): NotificationInvalidation {
  const client = new Client().setEndpoint(endpoint).setProject(projectId);
  const realtime = new Realtime(client);
  return createNotificationInvalidation({
    subscribe: async (channel, observer) => {
      let active = true;
      let connected = false;
      const reportConnected = () => {
        if (!active || connected) return;
        connected = true;
        observer.connected();
      };
      const reportDisconnected = () => {
        if (!active || !connected) return;
        connected = false;
        observer.disconnected();
      };
      realtime.onOpen(reportConnected);
      realtime.onClose(reportDisconnected);
      realtime.onError(reportDisconnected);
      const subscription = await realtime
        .subscribe(channel, () => {
          observer.invalidate();
        })
        .catch((error: unknown) => {
          active = false;
          throw error;
        });
      reportConnected();
      return {
        unsubscribe: async () => {
          active = false;
          await subscription.unsubscribe();
        },
      };
    },
  });
}
/* v8 ignore stop */
