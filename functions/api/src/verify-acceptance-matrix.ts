import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAcceptanceIndex } from "./acceptance-matrix.js";

export function verifyAcceptanceMatrix(): void {
  if (!process.argv.includes("--apply")) {
    throw new Error("ACCEPTANCE_MATRIX_APPLY_REQUIRED");
  }
  process.stdout.write(`${JSON.stringify(buildAcceptanceIndex())}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    verifyAcceptanceMatrix();
  } catch (error: unknown) {
    process.stderr.write(
      `${JSON.stringify({
        error: error instanceof Error ? error.message : "ACCEPTANCE_MATRIX_FAILED",
      })}\n`,
    );
    process.exitCode = 1;
  }
}
