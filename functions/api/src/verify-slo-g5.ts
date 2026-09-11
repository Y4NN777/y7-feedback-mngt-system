import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCapacityReport,
  buildMonthlySloReport,
  type SloMetric,
  type SloObservation,
} from "@y7-feedback/domain";

import { buildMeasurementSeriesIndex } from "./slo-series.js";
import { collectSloEvidenceSamples } from "./slo-g5-evidence.js";
import { routeSloAlerts } from "./slo-telemetry.js";

const concurrency = 4;
const commands = [
  "verify-appwrite-deployed-g1.js",
  "verify-appwrite-g2-attachment.js",
  "verify-appwrite-g3-conversation-lifecycle.js",
  "verify-appwrite-g3-workbench.js",
] as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("SLO_G5_CONFIGURATION_MISSING");
  return value;
}

function runScript(script: string): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [new URL(script, import.meta.url).pathname, "--apply", "--domain"],
      {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    let failureOutput = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (output.length <= 1_000_000) output += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (failureOutput.length <= 10_000) failureOutput += chunk;
    });
    child.on("error", () => {
      reject(new Error("SLO_G5_PROBE_PROCESS_FAILED"));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        const stableCode = [
          ...failureOutput.matchAll(/"(?:code|error)":"([A-Z0-9_]+)"/gu),
        ].at(-1)?.[1];
        reject(new Error(`SLO_G5_PROBE_FAILED:${script}:${stableCode ?? "UNKNOWN"}`));
        return;
      }
      try {
        const line = output.trim().split("\n").at(-1);
        if (!line) throw new Error();
        resolvePromise(JSON.parse(line) as unknown);
      } catch {
        reject(new Error("SLO_G5_PROBE_OUTPUT_INVALID"));
      }
    });
  });
}

async function probeUrl(url: string): Promise<boolean> {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  return response.ok;
}

export async function verifySloG5() {
  if (!process.argv.includes("--apply")) throw new Error("SLO_G5_APPLY_REQUIRED");
  if ((process.env.Y7_ENVIRONMENT?.trim() || "preview") !== "preview")
    throw new Error("SLO_G5_PREVIEW_REQUIRED");
  const release = required("RELEASE");
  const startedAt = new Date().toISOString();
  const evidence = await Promise.all(commands.map((command) => runScript(command)));
  const mail = await runScript("verify-preview-mail-catcher.js");
  const collected = [...evidence, mail].flatMap(collectSloEvidenceSamples);
  const measuredAt = new Date().toISOString();
  const observations: SloObservation[] = collected.map(([metric, value]) => ({
    metric,
    value,
    measuredAt,
    environment: "preview",
    release,
    eligible: true,
  }));
  const completedAt = new Date().toISOString();
  const report = buildCapacityReport({
    environment: "preview",
    release,
    startedAt,
    completedAt,
    concurrency,
    iterations: observations.length,
    observations,
  });
  if (report.status !== "passed") {
    process.stderr.write(
      `${JSON.stringify({
        result: "SLO_G5_THRESHOLDS_FAILED",
        series: report.series.map(({ id, metric, result }) => ({
          id,
          metric,
          status: result.status,
          sampleCount: result.sampleCount,
          value: result.status === "insufficient_data" ? null : result.value,
          target: result.status === "insufficient_data" ? null : result.target,
        })),
      })}\n`,
    );
    throw new Error("SLO_G5_THRESHOLDS_FAILED");
  }
  const present = new Set<SloMetric>(observations.map(({ metric }) => metric));
  if (report.series.some(({ metric }) => !present.has(metric)))
    throw new Error("SLO_G5_SERIES_INCOMPLETE");

  const healthUrl = new URL("/health", required("Y7_FUNCTION_DOMAIN_URL")).toString();
  const rootUrl = required("Y7_WEB_ORIGIN");
  const [syntheticUptimePassed, webRumOriginPassed] = await Promise.all([
    probeUrl(healthUrl),
    probeUrl(rootUrl),
  ]);
  if (!syntheticUptimePassed || !webRumOriginPassed)
    throw new Error("SLO_G5_AVAILABILITY_PROBE_FAILED");

  const historicalMonth = "2026-08";
  const monthly = buildMonthlySloReport({
    month: historicalMonth,
    generatedAt: "2026-09-01T00:00:00.000Z",
    observations: [],
  });
  if (monthly.status !== "insufficient_data")
    throw new Error("SLO_G5_MONTHLY_HISTORY_INVALID");
  const failingMonthly = buildMonthlySloReport({
    month: historicalMonth,
    generatedAt: "2026-09-01T00:00:00.000Z",
    observations: [
      {
        metric: "critical_api_ms",
        value: 501,
        measuredAt: "2026-08-31T23:59:59.000Z",
        environment: "production",
        release,
        eligible: true,
      },
    ],
  });
  const alerts: unknown[] = [];
  const routed = await routeSloAlerts(failingMonthly, {
    send: (alert) => {
      alerts.push(alert);
      return Promise.resolve();
    },
  });
  if (routed.sent !== 1 || alerts.length !== 1)
    throw new Error("SLO_G5_ALERT_ROUTE_FAILED");

  const seriesIndex = buildMeasurementSeriesIndex();
  process.stdout.write(
    `${JSON.stringify({
      result: "SLO_G5_PASSED",
      release,
      envelope: report.envelope,
      sampleCount: observations.length,
      series: report.series.map(({ id, metric, result }) => ({
        id,
        metric,
        status: result.status,
        sampleCount: result.sampleCount,
        value: result.status === "insufficient_data" ? null : result.value,
        target: result.status === "insufficient_data" ? null : result.target,
      })),
      syntheticUptimePassed,
      webRumOriginPassed,
      alertRoutingPassed: true,
      monthlyHistoryStatus: monthly.status,
      measurementSeriesIndexed: seriesIndex.length,
    })}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifySloG5().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({ error: error instanceof Error ? error.message : "SLO_G5_FAILED" })}\n`,
    );
    process.exitCode = 1;
  });
}
