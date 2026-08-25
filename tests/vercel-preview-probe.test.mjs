import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectVercelPreview,
  runVercelPreviewProbe,
} from "../scripts/vercel-preview-probe.mjs";

const securityHeaders = {
  "content-security-policy": "default-src 'self'; object-src 'none'",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function response(body, headers = {}, status = 200) {
  return new Response(body, { status, headers });
}

test("BDD-VER-DEPLOYED-001 accepts a public SPA deep link with safe cache policy", async () => {
  const requestedPaths = [];
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    requestedPaths.push(path);

    if (path === "/assets/index-a1b2c3.js") {
      return response("export {};", {
        ...securityHeaders,
        "cache-control": "public, max-age=31536000, immutable",
      });
    }

    if (path === "/manifest.webmanifest" || path === "/sw.js") {
      return response("pwa", {
        ...securityHeaders,
        "cache-control": "public, max-age=0, must-revalidate",
      });
    }

    if (path === "/api/private") {
      return response("not found", securityHeaders, 404);
    }

    const shell =
      '<!doctype html><script type="module" src="/assets/index-a1b2c3.js"></script>';
    const vercelToolbar =
      '<script async data-explicit-opt-in="true" data-deployment-id="deployment" src="https://vercel.live/_next-live/feedback/feedback.js"></script>';

    return response(path === "/" ? `${shell}\n${vercelToolbar}` : `${shell}\n`, {
      ...securityHeaders,
      "cache-control": "public, max-age=0, must-revalidate",
      "content-type": "text/html; charset=utf-8",
    });
  };

  const result = await runVercelPreviewProbe({
    baseUrl: "https://preview.example",
    deepLink: "/wisemoney",
    fetchImpl,
  });

  assert.deepEqual(result, {
    status: "ok",
    public: true,
    deepLink: true,
    shellRevalidated: true,
    pwaRevalidated: true,
    immutableAsset: true,
    securityHeaders: true,
    reservedApiDenied: true,
  });
  assert.deepEqual(requestedPaths, [
    "/",
    "/wisemoney",
    "/manifest.webmanifest",
    "/sw.js",
    "/assets/index-a1b2c3.js",
    "/api/private",
  ]);
});

test("BDD-VER-DEPLOYED-002 fails closed when Vercel authentication intercepts the shell", async () => {
  const fetchImpl = async () =>
    response("Authentication Required", { location: "https://vercel.com/sso" }, 302);

  await assert.rejects(
    runVercelPreviewProbe({
      baseUrl: "https://preview.example",
      deepLink: "/wisemoney",
      fetchImpl,
    }),
    /VERCEL_PREVIEW_NOT_PUBLIC/u,
  );
});

test("BDD-VER-DEPLOYED-003 rejects a shell with incomplete security or cache headers", () => {
  assert.throws(
    () =>
      inspectVercelPreview({
        root: response('<script src="/assets/index-a1b2c3.js"></script>', {
          "cache-control": "no-cache",
          "content-type": "text/html",
        }),
        rootBody: '<script src="/assets/index-a1b2c3.js"></script>',
        deepLink: response("different", { "content-type": "text/html" }),
        deepLinkBody: "different",
        manifest: response("pwa"),
        serviceWorker: response("pwa"),
        asset: response("asset"),
        reservedApi: response("shell", { "content-type": "text/html" }),
        reservedApiBody: "shell",
      }),
    /VERCEL_PREVIEW_POLICY_FAILED/u,
  );
});
