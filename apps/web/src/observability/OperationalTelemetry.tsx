import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

export function OperationalTelemetry() {
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
