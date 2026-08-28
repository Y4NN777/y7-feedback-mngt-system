import { Channel, Client, Realtime } from "appwrite";

export interface NotificationRealtimePort {
  subscribe(
    channel: string,
    callback: () => void,
  ): Promise<{ readonly unsubscribe: () => Promise<void> }>;
}

export interface NotificationInvalidation {
  subscribe(
    target: { readonly databaseId: string; readonly tableId: string },
    onInvalidate: () => void,
  ): Promise<() => Promise<void>>;
}

export function createNotificationInvalidation(
  realtime: NotificationRealtimePort,
): NotificationInvalidation {
  return {
    async subscribe(target, onInvalidate) {
      const channel = Channel.tablesdb(target.databaseId)
        .table(target.tableId)
        .row()
        .toString();
      const subscription = await realtime.subscribe(channel, onInvalidate);
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
    subscribe: async (channel, callback) => {
      const subscription = await realtime.subscribe(channel, callback);
      return { unsubscribe: () => subscription.unsubscribe() };
    },
  });
}
/* v8 ignore stop */
