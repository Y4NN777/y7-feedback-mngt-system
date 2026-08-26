import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@vercel/analytics/react", () => ({
  Analytics: (props: Record<string, unknown>) => (
    <div data-props={Object.keys(props).join(",")} data-testid="vercel-analytics" />
  ),
}));

vi.mock("@vercel/speed-insights/react", () => ({
  SpeedInsights: (props: Record<string, unknown>) => (
    <div
      data-props={Object.keys(props).join(",")}
      data-testid="vercel-speed-insights"
    />
  ),
}));

import { OperationalTelemetry } from "./OperationalTelemetry";

describe("operational telemetry composition", () => {
  it("BDD-OBS-DATA-001 mounts only provider-standard collectors without application payloads", () => {
    render(<OperationalTelemetry />);

    expect(screen.getByTestId("vercel-analytics")).toHaveAttribute("data-props", "");
    expect(screen.getByTestId("vercel-speed-insights")).toHaveAttribute(
      "data-props",
      "",
    );
  });
});
