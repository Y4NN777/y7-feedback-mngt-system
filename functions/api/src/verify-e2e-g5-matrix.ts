import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildE2eG5Index } from "./e2e-g5-matrix.js";

export function verifyE2eG5Matrix(): void {
  if (!process.argv.includes("--apply")) {
    throw new Error("E2E_G5_MATRIX_APPLY_REQUIRED");
  }
  process.stdout.write(`${JSON.stringify(buildE2eG5Index())}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    verifyE2eG5Matrix();
  } catch (error: unknown) {
    process.stderr.write(
      `${JSON.stringify({
        error: error instanceof Error ? error.message : "E2E_G5_MATRIX_FAILED",
      })}\n`,
    );
    process.exitCode = 1;
  }
}
