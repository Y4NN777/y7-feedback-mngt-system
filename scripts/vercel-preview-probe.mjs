import { pathToFileURL } from "node:url";

const REQUIRED_SECURITY_HEADERS = [
  "content-security-policy",
  "permissions-policy",
  "referrer-policy",
  "x-content-type-options",
];

function assertResponse(response, name) {
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`VERCEL_PREVIEW_NOT_PUBLIC:${name}:${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`VERCEL_PREVIEW_REQUEST_FAILED:${name}:${response.status}`);
  }
}

function isRevalidated(response) {
  const value = response.headers.get("cache-control") ?? "";
  return /max-age=0/u.test(value) && /must-revalidate/u.test(value);
}

function hasSecurityHeaders(response) {
  return REQUIRED_SECURITY_HEADERS.every((name) => response.headers.has(name));
}

function assetPathFrom(shell) {
  const match = shell.match(/["'](\/assets\/[^"']+\.(?:js|css))["']/u);
  if (!match?.[1]) {
    throw new Error("VERCEL_PREVIEW_ASSET_MISSING");
  }
  return match[1];
}

function applicationShell(shell) {
  return shell
    .replace(
      /\s*<script async data-explicit-opt-in="true" data-deployment-id="[^"]+" src="https:\/\/vercel\.live\/_next-live\/feedback\/feedback\.js"><\/script>\s*$/u,
      "",
    )
    .trimEnd();
}

export function inspectVercelPreview({
  root,
  rootBody,
  deepLink,
  deepLinkBody,
  manifest,
  serviceWorker,
  asset,
  reservedApi,
  reservedApiBody,
}) {
  for (const [name, response] of Object.entries({
    root,
    deepLink,
    manifest,
    serviceWorker,
    asset,
  })) {
    assertResponse(response, name);
  }

  const checks = {
    deepLink:
      applicationShell(rootBody) === applicationShell(deepLinkBody) &&
      root.headers.get("content-type")?.includes("text/html") === true &&
      deepLink.headers.get("content-type")?.includes("text/html") === true,
    shellRevalidated: isRevalidated(root) && isRevalidated(deepLink),
    pwaRevalidated: isRevalidated(manifest) && isRevalidated(serviceWorker),
    immutableAsset:
      /max-age=31536000/u.test(asset.headers.get("cache-control") ?? "") &&
      /immutable/u.test(asset.headers.get("cache-control") ?? ""),
    securityHeaders: [root, deepLink, manifest, serviceWorker, asset].every(
      hasSecurityHeaders,
    ),
    reservedApiDenied:
      reservedApi.status === 404 &&
      applicationShell(reservedApiBody) !== applicationShell(rootBody),
  };

  if (Object.values(checks).some((passed) => !passed)) {
    const failed = Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name)
      .join(",");
    throw new Error(`VERCEL_PREVIEW_POLICY_FAILED:${failed}`);
  }

  return { status: "ok", public: true, ...checks };
}

export async function runVercelPreviewProbe({ baseUrl, deepLink, fetchImpl = fetch }) {
  const origin = new URL(baseUrl);
  const request = async (path) =>
    fetchImpl(new URL(path, origin), { redirect: "manual" });

  const root = await request("/");
  assertResponse(root, "root");
  const rootBody = await root.text();
  const deepLinkResponse = await request(deepLink);
  const deepLinkBody = await deepLinkResponse.text();
  const manifest = await request("/manifest.webmanifest");
  const serviceWorker = await request("/sw.js");
  const asset = await request(assetPathFrom(rootBody));
  const reservedApi = await request("/api/private");
  const reservedApiBody = await reservedApi.text();

  return inspectVercelPreview({
    root,
    rootBody,
    deepLink: deepLinkResponse,
    deepLinkBody,
    manifest,
    serviceWorker,
    asset,
    reservedApi,
    reservedApiBody,
  });
}

async function main() {
  const baseUrl = process.env.Y7_VERCEL_PREVIEW_URL;
  if (!baseUrl) {
    console.error("vercel-preview-probe: CONFIG_MISSING");
    process.exitCode = 1;
    return;
  }

  try {
    const result = await runVercelPreviewProbe({
      baseUrl,
      deepLink: process.env.Y7_VERCEL_DEEP_LINK ?? "/wisemoney",
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    const code = error instanceof Error ? error.message.split(":", 1)[0] : "UNKNOWN";
    console.error(`vercel-preview-probe: ${code}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
