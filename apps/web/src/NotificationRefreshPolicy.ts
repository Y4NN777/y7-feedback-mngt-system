export const initialNotificationPollingDelay = 5_000;
export const maximumNotificationPollingDelay = 60_000;

export function nextNotificationPollingDelay(
  currentDelay: number,
  outcome: "ok" | "retryable",
): number {
  if (outcome === "ok") return initialNotificationPollingDelay;
  return Math.min(currentDelay * 2, maximumNotificationPollingDelay);
}
