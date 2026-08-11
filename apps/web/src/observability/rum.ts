import { onCLS, onINP, onLCP } from "web-vitals";

interface WebVitalMeasurement {
  readonly name: "CLS" | "INP" | "LCP";
  readonly navigationType: string;
  readonly rating: "good" | "needs-improvement" | "poor";
  readonly value: number;
}

type WebVitalCallback = (measurement: WebVitalMeasurement) => void;

export interface WebVitalsSource {
  readonly onCLS: (callback: WebVitalCallback) => void;
  readonly onINP: (callback: WebVitalCallback) => void;
  readonly onLCP: (callback: WebVitalCallback) => void;
}

export interface RumConfig {
  readonly environment: "development" | "preview" | "production";
  readonly release: string;
}

export interface WebVitalEvent {
  readonly event: "rum.web_vital";
  readonly environment: RumConfig["environment"];
  readonly release: string;
  readonly metricName: WebVitalMeasurement["name"];
  readonly metricValue: number;
  readonly rating: WebVitalMeasurement["rating"];
  readonly navigationType: string;
}

export type RumSink = (event: WebVitalEvent) => void;

const browserWebVitals: WebVitalsSource = {
  onCLS: (callback) => {
    onCLS(callback);
  },
  onINP: (callback) => {
    onINP(callback);
  },
  onLCP: (callback) => {
    onLCP(callback);
  },
};

export function startWebVitals(
  sink: RumSink,
  config: RumConfig,
  source: WebVitalsSource = browserWebVitals,
): void {
  const report = (measurement: WebVitalMeasurement) => {
    sink({
      event: "rum.web_vital",
      environment: config.environment,
      release: config.release,
      metricName: measurement.name,
      metricValue: measurement.value,
      rating: measurement.rating,
      navigationType: measurement.navigationType,
    });
  };

  source.onCLS(report);
  source.onINP(report);
  source.onLCP(report);
}
