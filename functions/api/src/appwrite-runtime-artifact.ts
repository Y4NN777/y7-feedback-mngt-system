import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const runtimeArtifactEntries = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "functions/api/package.json",
  "functions/api/dist/runtime",
  "packages/config/package.json",
  "packages/config/dist",
  "packages/domain/package.json",
  "packages/domain/dist",
] as const;

export async function stageAppwriteRuntimeArtifact(
  repositoryRoot: string,
  destination: string,
): Promise<void> {
  await mkdir(destination, { recursive: true });
  await Promise.all(
    runtimeArtifactEntries.map(async (entry) => {
      const target = join(destination, entry);
      await mkdir(dirname(target), { recursive: true });
      await cp(join(repositoryRoot, entry), target, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
    }),
  );
}
