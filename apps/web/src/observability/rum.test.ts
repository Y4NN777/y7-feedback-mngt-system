import { describe, expect, it, vi } from "vitest";

import { startWebVitals, type WebVitalsSource } from "./rum";

const webVitalsMocks = vi.hoisted(() => ({
  onCLS: vi.fn(),
  onINP: vi.fn(),
  onLCP: vi.fn(),
}));

vi.mock("web-vitals", () => webVitalsMocks);

describe("browser real-user monitoring adapter", () => {
  it("BDD-OBS-003 emits only minimized Web Vital facts", () => {
    const sink = vi.fn();
    const source: WebVitalsSource = {
      onCLS: (callback) => {
        callback({
          name: "CLS",
          value: 0.04,
          rating: "good",
          navigationType: "navigate",
        });
      },
      onINP: (callback) => {
        callback({
          name: "INP",
          value: 115,
          rating: "good",
          navigationType: "navigate",
        });
      },
      onLCP: (callback) => {
        callback({
          name: "LCP",
          value: 1800,
          rating: "good",
          navigationType: "navigate",
        });
      },
    };

    startWebVitals(sink, { environment: "preview", release: "commit-123" }, source);

    expect(sink).toHaveBeenCalledTimes(3);
    expect(sink).toHaveBeenNthCalledWith(1, {
      event: "rum.web_vital",
      environment: "preview",
      release: "commit-123",
      metricName: "CLS",
      metricValue: 0.04,
      rating: "good",
      navigationType: "navigate",
    });
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(
      /url|query|user|workspace|project|feedback/iu,
    );
  });

  it("BDD-OBS-003 registers all three browser measurements", () => {
    startWebVitals(vi.fn(), {
      environment: "production",
      release: "commit-456",
    });

    expect(webVitalsMocks.onCLS).toHaveBeenCalledOnce();
    expect(webVitalsMocks.onINP).toHaveBeenCalledOnce();
    expect(webVitalsMocks.onLCP).toHaveBeenCalledOnce();
  });
});
