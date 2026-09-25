import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAcceptanceCommands } from "./acceptance-matrix.js";

/* v8 ignore start -- process spawning is exercised only by the explicit acceptance CLI. */
function executeCommand(command: string): void {
  const result = spawnSync("pnpm", [command], {
    env: process.env,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    throw new Error("ACCEPTANCE_EVIDENCE_FAILED");
  }
}
/* v8 ignore stop */

export function verifyAcceptance(
  execute: (command: string) => void = executeCommand,
): void {
  if (!process.argv.includes("--apply")) throw new Error("ACCEPTANCE_APPLY_REQUIRED");
  const commands = buildAcceptanceCommands();
  for (const command of commands) execute(command);
  process.stdout.write(
    `${JSON.stringify({ result: "ACCEPTANCE_PASSED", evidenceCommands: commands })}\n`,
  );
}

/* v8 ignore start -- CLI error mapping is exercised by the explicit acceptance command. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    verifyAcceptance();
  } catch (error: unknown) {
    process.stderr.write(
      `${JSON.stringify({ error: error instanceof Error ? error.message : "ACCEPTANCE_FAILED" })}\n`,
    );
    process.exitCode = 1;
  }
}
/* v8 ignore stop */
