import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scanRoots = [
  ".env.example",
  "apps/web/src",
  "apps/web/public",
  "apps/web/dist",
  "functions/api/src",
  "packages/config/src",
  "packages/domain/src",
  "services/antivirus/src",
  "services/antivirus/compose.yaml",
  "services/antivirus/Dockerfile",
  "scripts/antivirus-smoke.mjs",
  "vercel.json",
];
const textExtensions = new Set([
  ".css",
  ".example",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".yaml",
]);

const prohibitedPatterns = [
  { label: "GitHub personal access token", expression: /ghp_[A-Za-z0-9]{20,}/u },
  { label: "GitLab personal access token", expression: /glpat-[A-Za-z0-9_-]{20,}/u },
  {
    label: "private key material",
    expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  },
  { label: "test secret sentinel", expression: /y7-test-secret-do-not-ship/u },
];

const prohibitedPublicVariable =
  /^\s*VITE_[A-Z0-9_]*(?:SECRET|TOKEN|PRIVATE_KEY|API_KEY|ACCESS_PROOF|PASSWORD)[A-Z0-9_]*\s*=/mu;

export function findProhibitedContent(path, content) {
  const findings = [];

  for (const pattern of prohibitedPatterns) {
    if (pattern.expression.test(content)) {
      findings.push(`${path}: ${pattern.label}`);
    }
  }

  if (prohibitedPublicVariable.test(content)) {
    findings.push(`${path}: secret-bearing VITE_ variable`);
  }

  return findings;
}

async function collectFiles(path) {
  const absolutePath = resolve(repositoryRoot, path);
  const details = await stat(absolutePath).catch((error) => {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  });

  if (!details) {
    return [];
  }
  if (details.isFile()) {
    return absolutePath.endsWith("/Dockerfile") ||
      textExtensions.has(extname(absolutePath))
      ? [absolutePath]
      : [];
  }

  const entries = await readdir(absolutePath, { withFileTypes: true });

  const files = [];
  for (const entry of entries) {
    const child = join(absolutePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(relative(repositoryRoot, child))));
    } else if (
      entry.isFile() &&
      !entry.name.includes(".test.") &&
      (entry.name === "Dockerfile" || textExtensions.has(extname(entry.name)))
    ) {
      files.push(child);
    }
  }
  return files;
}

export async function scanRepository() {
  const files = (await Promise.all(scanRoots.map(collectFiles))).flat();
  const findings = [];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    findings.push(...findProhibitedContent(relative(repositoryRoot, file), content));
  }

  return { filesScanned: files.length, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await scanRepository();
  if (result.findings.length > 0) {
    for (const finding of result.findings) {
      console.error(finding);
    }
    process.exitCode = 1;
  } else {
    console.log(`security-scan: ${result.filesScanned} files checked, 0 findings`);
  }
}
