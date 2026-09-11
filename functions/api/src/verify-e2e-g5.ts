import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildE2eG5Commands } from "./e2e-g5-matrix.js";

/* v8 ignore start -- process spawning is exercised only by the explicit G5 CLI. */
function executeCommand(command: string): void {
  const result = spawnSync("pnpm", [command], {
    env: process.env,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    throw new Error("E2E_G5_EVIDENCE_FAILED");
  }
}
/* v8 ignore stop */

export function verifyE2eG5(execute: (command: string) => void = executeCommand): void {
  if (!process.argv.includes("--apply")) throw new Error("E2E_G5_APPLY_REQUIRED");
  const commands = buildE2eG5Commands();
  for (const command of commands) execute(command);
  process.stdout.write(
    `${JSON.stringify({ result: "E2E_G5_PASSED", evidenceCommands: commands })}\n`,
  );
}

/* v8 ignore start -- CLI error mapping is exercised by the explicit G5 command. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    verifyE2eG5();
  } catch (error: unknown) {
    process.stderr.write(
      `${JSON.stringify({ error: error instanceof Error ? error.message : "E2E_G5_FAILED" })}\n`,
    );
    process.exitCode = 1;
  }
}
/* v8 ignore stop */
