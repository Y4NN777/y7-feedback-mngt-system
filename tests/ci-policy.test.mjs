import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("BDD-CI-001 runs the complete pull-request gate with pinned least-privilege actions", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /pull_request:/u);
  assert.match(workflow, /permissions:\s+contents: read/u);
  assert.match(workflow, /node-version: 24/u);
  assert.match(workflow, /version: 10\.32\.1/u);

  const actionReferences = [...workflow.matchAll(/^\s+(?:- )?uses: ([^\s#]+)/gmu)].map(
    (match) => match[1],
  );
  assert.ok(actionReferences.length >= 3);
  for (const reference of actionReferences) {
    assert.match(reference, /^[^@\s]+@[0-9a-f]{40}$/u);
  }

  for (const command of [
    "pnpm install --frozen-lockfile",
    "pnpm format:check",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    "pnpm test:coverage",
    "pnpm build",
    "pnpm verify:antivirus:local",
    "pnpm security:scan",
    "pnpm --filter @y7-feedback/web exec playwright install --with-deps chromium",
    "pnpm test:e2e",
  ]) {
    assert.ok(workflow.includes(command), `missing CI command: ${command}`);
  }

  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./u);
});

test("BDD-CI-002 builds runtime workspace dependencies before the E2E server", async () => {
  const playwrightConfig = await readFile(
    new URL("../apps/web/playwright.config.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    playwrightConfig,
    /command:\s*"pnpm --filter @y7-feedback\/config build && pnpm --filter @y7-feedback\/domain build && pnpm build && pnpm preview --host 127\.0\.0\.1"/u,
  );
});

test("BDD-CI-005 publishes the antivirus image with least privilege and immutable provenance", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/antivirus-image.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /branches:\s+- main/u);
  assert.match(workflow, /permissions:\s+contents: read\s+packages: write/u);
  assert.match(workflow, /docker login .*--password-stdin/u);
  assert.match(workflow, /services\/antivirus\/Dockerfile/u);
  assert.match(workflow, /sha-\$GITHUB_SHA/u);
  assert.match(workflow, /IMAGE_NAME: y4nn777\/y7-feedback-antivirus/u);
  assert.match(workflow, /\$IMAGE_NAME:preview/u);
  assert.doesNotMatch(workflow, /secrets\./u);

  const actionReferences = [...workflow.matchAll(/^\s+(?:- )?uses: ([^\s#]+)/gmu)].map(
    (match) => match[1],
  );
  assert.deepEqual(actionReferences, [
    "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
  ]);
});

test("BDD-CI-004 loads ignored Appwrite credentials without shell export", async () => {
  const rootPackage = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(
    rootPackage.scripts["provision:appwrite"],
    "pnpm --filter @y7-feedback/config build && pnpm --filter @y7-feedback/domain build && pnpm --filter @y7-feedback/api build && node --env-file=.env.appwrite-preview functions/api/dist/provision-appwrite.js --apply",
  );
  assert.equal(
    rootPackage.scripts["verify:appwrite:g1"],
    "pnpm --filter @y7-feedback/config build && pnpm --filter @y7-feedback/domain build && pnpm --filter @y7-feedback/api build && node --env-file=.env.appwrite-preview functions/api/dist/verify-appwrite-g1.js --apply",
  );
});

test("BDD-REC-301 runs the real recovery drill with isolated OIDC authority", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/recovery-drill.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /permissions:\s+contents: read\s+id-token: write/u);
  assert.match(workflow, /environment: recovery-drill/u);
  assert.match(
    workflow,
    /client-id: \$\{\{ vars\.AZURE_RECOVERY_DRILL_CLIENT_ID \}\}/u,
  );
  assert.match(
    workflow,
    /APPWRITE_API_KEY: \$\{\{ secrets\.Y7_RECOVERY_APPWRITE_API_KEY \}\}/u,
  );
  assert.match(workflow, /run: pnpm verify:recovery:g5/u);
  assert.doesNotMatch(workflow, /AZURE_(?:CLIENT_)?SECRET/u);

  const actionReferences = [...workflow.matchAll(/^\s+(?:- )?uses: ([^\s#]+)/gmu)].map(
    (match) => match[1],
  );
  assert.ok(actionReferences.length >= 4);
  for (const reference of actionReferences)
    assert.match(reference, /^[^@\s]+@[0-9a-f]{40}$/u);

  const rootPackage = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.match(
    rootPackage.scripts["verify:recovery:g5"],
    /node --env-file-if-exists=\.env\.appwrite-preview .* --apply$/u,
  );

  const provision = await readFile(
    new URL("../scripts/provision-recovery-azure.sh", import.meta.url),
    "utf8",
  );
  assert.match(provision, /id-y7-feedback-recovery-drill/u);
  assert.match(provision, /github-isolated-drill/u);
  assert.match(provision, /environment:recovery-drill/u);
  assert.match(provision, /Storage Blob Data Contributor/u);
  assert.match(provision, /GITHUB_OIDC_REPOSITORY_SUBJECT/u);
});

test("BDD-REL-303 schedules encrypted Production backup with dedicated authority", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/recovery-backup.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /cron: "17 2 \* \* \*"/u);
  assert.match(workflow, /environment: production-recovery-backup/u);
  assert.match(workflow, /Y7_ENVIRONMENT: production/u);
  assert.match(workflow, /APPWRITE_ENVIRONMENT: production/u);
  assert.match(workflow, /Y7_PRODUCTION_APPWRITE_PROJECT_ID/u);
  assert.match(workflow, /Y7_PREVIEW_APPWRITE_PROJECT_ID/u);
  assert.match(workflow, /secrets\.Y7_PRODUCTION_RECOVERY_APPWRITE_API_KEY/u);
  assert.match(workflow, /run: pnpm recovery:backup/u);
  assert.doesNotMatch(workflow, /Y7_RECOVERY_SOURCE_ENVIRONMENT/u);

  const provision = await readFile(
    new URL("../scripts/provision-recovery-azure.sh", import.meta.url),
    "utf8",
  );
  assert.match(
    provision,
    /repo:\$\{OIDC_REPOSITORY_SUBJECT\}:environment:production-recovery-backup/u,
  );
  assert.match(
    provision,
    /GITHUB_OIDC_REPOSITORY_SUBJECT:-Y4NN777\/y7-feedback-mngt-system/u,
  );
  assert.doesNotMatch(provision, /Y4NN777@171065166/u);
});

test("BDD-E2E-301 runs the complete G5 evidence pack with ephemeral secret material", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/g5-evidence.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(
    workflow,
    /permissions:\s+contents: read\s+id-token: write\s+issues: write/u,
  );
  assert.match(workflow, /environment: g5-preview/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(
    workflow,
    /client-id: \$\{\{ vars\.AZURE_RECOVERY_DRILL_CLIENT_ID \}\}/u,
  );
  assert.match(
    workflow,
    /Y7_PREVIEW_EVIDENCE_ENV: \$\{\{ secrets\.Y7_PREVIEW_EVIDENCE_ENV \}\}/u,
  );
  assert.match(workflow, /install -m 600 \/dev\/null \.env\.appwrite-preview/u);
  assert.match(workflow, /trap 'rm -f \.env\.appwrite-preview' EXIT/u);
  assert.match(workflow, /pnpm provision:appwrite:preview/u);
  assert.match(workflow, /pnpm configure:appwrite:function:preview/u);
  assert.match(workflow, /pnpm deploy:appwrite:function:preview/u);
  assert.match(workflow, /pnpm verify:e2e:g5/u);
  assert.doesNotMatch(workflow, /AZURE_(?:CLIENT_)?SECRET/u);
  assert.doesNotMatch(workflow, /upload-artifact/u);

  const actionReferences = [...workflow.matchAll(/^\s+(?:- )?uses: ([^\s#]+)/gmu)].map(
    (match) => match[1],
  );
  assert.ok(actionReferences.length >= 4);
  for (const reference of actionReferences)
    assert.match(reference, /^[^@\s]+@[0-9a-f]{40}$/u);

  const rootPackage = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.match(
    rootPackage.scripts["verify:providers:g4:message-sync"],
    /node --env-file-if-exists=\.env\.appwrite-preview/u,
  );
});

test("BDD-SLO-301 runs the real Preview SLO gate with protected least-privilege configuration", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/slo-g5.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /permissions:\s+contents: read/u);
  assert.doesNotMatch(workflow, /id-token: write/u);
  assert.match(workflow, /environment: g5-preview/u);
  assert.match(
    workflow,
    /Y7_PREVIEW_EVIDENCE_ENV: \$\{\{ secrets\.Y7_PREVIEW_EVIDENCE_ENV \}\}/u,
  );
  assert.match(workflow, /install -m 600 \/dev\/null \.env\.appwrite-preview/u);
  assert.match(workflow, /trap 'rm -f \.env\.appwrite-preview' EXIT/u);
  assert.match(workflow, /pnpm provision:appwrite:preview/u);
  assert.match(workflow, /pnpm configure:appwrite:function:preview/u);
  assert.match(workflow, /pnpm deploy:appwrite:function:preview/u);
  assert.match(workflow, /pnpm verify:slo:g5/u);

  const actionReferences = [...workflow.matchAll(/^\s+(?:- )?uses: ([^\s#]+)/gmu)].map(
    (match) => match[1],
  );
  assert.ok(actionReferences.length >= 3);
  for (const reference of actionReferences)
    assert.match(reference, /^[^@\s]+@[0-9a-f]{40}$/u);
});

test("BDD-REL-301 defines a monitored permanent Production antivirus service", async () => {
  const template = await readFile(
    new URL("../infra/azure/production-antivirus.bicep", import.meta.url),
    "utf8",
  );

  assert.match(template, /@secure\(\)[\s\S]*?param scannerHmacKey string/u);
  assert.match(template, /Microsoft\.App\/managedEnvironments@2024-03-01/u);
  assert.match(template, /Microsoft\.App\/containerApps@2024-03-01/u);
  assert.match(template, /Microsoft\.OperationalInsights\/workspaces@2023-09-01/u);
  assert.match(template, /minReplicas: 1/u);
  assert.match(template, /maxReplicas: 2/u);
  assert.match(template, /secretRef: 'scanner-hmac-key'/u);
  assert.match(template, /path: '\/health'/u);
  assert.match(template, /metricName: 'Requests'/u);
  assert.match(template, /metricName: 'Replicas'/u);
  assert.match(template, /param actionGroupId string/u);
  assert.doesNotMatch(template, /param actionGroupId string = ''/u);
  assert.match(template, /actions: alertActions/u);
  assert.match(template, /statusCodeCategory/u);
  assert.match(template, /retentionInDays: 30/u);
  assert.doesNotMatch(template, /customDomains|certificateId/u);
});

test("BDD-REL-302 deploys the Production scanner only through protected OIDC", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/production-antivirus.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /permissions:\s+contents: read\s+id-token: write/u);
  assert.match(workflow, /packages: write/u);
  assert.match(workflow, /environment: production/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /AZURE_PRODUCTION_CLIENT_ID/u);
  assert.match(workflow, /secrets\.Y7_PRODUCTION_SCANNER_HMAC_KEY/u);
  assert.match(workflow, /AZURE_PRODUCTION_ACTION_GROUP_ID/u);
  assert.match(workflow, /az resource show --ids "\$AZURE_ACTION_GROUP_ID"/u);
  assert.match(workflow, /infra\/azure\/production-antivirus\.bicep/u);
  assert.match(workflow, /ghcr\.io\/y4nn777\/y7-feedback-antivirus:sha-\$GITHUB_SHA/u);
  assert.match(workflow, /gatewayRelease="\$GITHUB_SHA"/u);
  assert.match(workflow, /health\?\.release !== process\.env\.EXPECTED_RELEASE/u);
  assert.match(workflow, /docker build --file services\/antivirus\/Dockerfile/u);
  assert.match(workflow, /docker push "\$IMAGE"/u);
  assert.match(workflow, /az deployment group create/u);
  assert.match(workflow, /monitor action-group test-notifications create/u);
  assert.match(workflow, /ACTION_GROUP_NAME="\$\{AZURE_ACTION_GROUP_ID##\*\/\}"/u);
  assert.match(workflow, /--action-group "\$ACTION_GROUP_NAME"/u);
  assert.match(workflow, /--alert-type metricstaticthreshold/u);
  assert.match(workflow, /PRODUCTION_ALERT_TEST_SUBMITTED/u);
  assert.match(workflow, /curl --fail --silent --show-error/u);
  assert.doesNotMatch(workflow, /AZURE_(?:CLIENT_)?SECRET/u);
  assert.doesNotMatch(workflow, /delete|rm -rf/u);
  assert.doesNotMatch(workflow, /az group create/u);

  const actionReferences = [...workflow.matchAll(/^\s+(?:- )?uses: ([^\s#]+)/gmu)].map(
    (match) => match[1],
  );
  assert.ok(actionReferences.length >= 2);
  for (const reference of actionReferences)
    assert.match(reference, /^[^@\s]+@[0-9a-f]{40}$/u);
});

test("BDD-REL-426 exposes and verifies the immutable scanner release identity", async () => {
  const template = await readFile(
    new URL("../infra/azure/production-antivirus.bicep", import.meta.url),
    "utf8",
  );
  const gateway = await readFile(
    new URL("../services/antivirus/src/main.ts", import.meta.url),
    "utf8",
  );
  const verifier = await readFile(
    new URL("../functions/api/src/verify-production-release.ts", import.meta.url),
    "utf8",
  );

  assert.match(template, /param gatewayRelease string/u);
  assert.match(template, /name: 'Y7_SCANNER_RELEASE'\s+value: gatewayRelease/u);
  assert.match(gateway, /parseScannerRelease\(process\.env\.Y7_SCANNER_RELEASE\)/u);
  assert.match(gateway, /JSON\.stringify\(\{ status: "ok", release \}\)/u);
  assert.match(verifier, /assertProductionScannerRelease/u);
  assert.match(verifier, /required\("GITHUB_SHA"\)/u);
  assert.match(
    verifier,
    /webHeaders === undefined \? "" : await webHeaders\.text\(\)/u,
  );
});

test("BDD-REL-304 bootstraps Production Azure with environment OIDC", async () => {
  const bootstrap = await readFile(
    new URL("../scripts/provision-production-azure.sh", import.meta.url),
    "utf8",
  );
  assert.match(bootstrap, /repo:\$\{OIDC_REPOSITORY_SUBJECT\}:environment:production/u);
  assert.match(bootstrap, /Y4NN777\/y7-feedback-mngt-system/u);
  assert.match(bootstrap, /identity federated-credential/u);
  assert.match(bootstrap, /monitor action-group create/u);
  assert.match(bootstrap, /--role Contributor/u);
  assert.match(bootstrap, /--scope "\$RESOURCE_GROUP_ID"/u);
  assert.doesNotMatch(bootstrap, /AZURE_(?:CLIENT_)?SECRET/u);
  assert.doesNotMatch(bootstrap, /subscription.*(?:Owner|Contributor)/iu);
});

test("BDD-REL-406 stages, promotes, rolls back and restores Production", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/production-release.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /permissions:\s+contents: read/u);
  assert.match(workflow, /environment: production/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(
    workflow,
    /Y7_PRODUCTION_RELEASE_ENV: \$\{\{ secrets\.Y7_PRODUCTION_RELEASE_ENV \}\}/u,
  );
  assert.match(workflow, /VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/u);
  assert.match(workflow, /pnpm provision:appwrite:production/u);
  assert.match(workflow, /pnpm configure:appwrite:function:production/u);
  assert.match(workflow, /pnpm deploy:appwrite:function:production/u);
  assert.match(workflow, /printf '\\nRELEASE=%s\\n' "\$GITHUB_SHA"/u);
  assert.match(workflow, /vercel@50\.35\.0 deploy --prod --skip-domain/u);
  assert.match(workflow, /--build-env VITE_RELEASE="\$GITHUB_SHA"/u);
  assert.match(workflow, /vercel@50\.35\.0 promote/u);
  assert.match(workflow, /vercel@50\.35\.0 rollback/u);
  assert.match(workflow, /vercel@50\.35\.0 rollback status/u);
  assert.match(workflow, /api\.vercel\.com\/v13\/deployments/u);
  assert.match(workflow, /PREVIOUS_WEB_DEPLOYMENT_ID/u);
  assert.match(workflow, /PREVIOUS_WEB_DEPLOYMENT_TARGET/u);
  assert.match(workflow, /PREVIOUS_FUNCTION_DEPLOYMENT_ID/u);
  assert.match(workflow, /NEW_WEB_DEPLOYMENT_ID/u);
  assert.match(workflow, /PRODUCTION_WEB_ROUTING_MISMATCH/u);
  assert.match(workflow, /pnpm verify:release:production/u);
  assert.match(workflow, /pnpm verify:mail:production/u);
  assert.match(workflow, /pnpm verify:providers:production:github/u);
  assert.match(workflow, /PRODUCTION_GITHUB_EVIDENCE_AUTHORITY_MISSING/u);
  assert.match(workflow, /trap cleanup EXIT/u);
  assert.match(
    workflow,
    /if \[ "\$status" -ne 0 \] && \\\s+\[ "\$RESTORE_PREVIOUS_ON_FAILURE" = "1" \]/u,
  );
  assert.match(
    workflow,
    /vercel@50\.35\.0 promote "\$PREVIOUS_WEB_DEPLOYMENT_TARGET"/u,
  );
  assert.match(workflow, /production-function-rollback\.js capture/u);
  assert.match(workflow, /production-function-rollback\.js restore/u);
  assert.doesNotMatch(workflow, /ROLLBACK_ACTIVE/u);
  assert.doesNotMatch(workflow, /upload-artifact/u);

  const webBuild = await readFile(
    new URL("../apps/web/vite.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(webBuild, /parseWebReleaseIdentity\(process\.env\.VITE_RELEASE\)/u);
  assert.match(webBuild, /attrs: \{ name: "y7-release", content: release \}/u);

  const rootPackage = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.match(
    rootPackage.scripts["verify:mail:production"],
    /verify-production-smtp\.js --apply --production$/u,
  );

  const actionReferences = [...workflow.matchAll(/^\s+(?:- )?uses: ([^\s#]+)/gmu)].map(
    (match) => match[1],
  );
  assert.ok(actionReferences.length >= 3);
  for (const reference of actionReferences)
    assert.match(reference, /^[^@\s]+@[0-9a-f]{40}$/u);
});

test("BDD-REL-407 proves deleted Appwrite state stays absent across Function rollback", async () => {
  const verifier = await readFile(
    new URL("../functions/api/src/verify-production-release.ts", import.meta.url),
    "utf8",
  );
  const continuity = await readFile(
    new URL("../functions/api/src/production-deletion-continuity.ts", import.meta.url),
    "utf8",
  );

  assert.match(verifier, /proveProductionDeletionContinuity/u);
  assert.match(verifier, /authoritativeDeletionPreserved/u);
  assert.match(continuity, /await input\.rollback\(\)/u);
  assert.match(continuity, /finally \{\s+await input\.rollForward\(\)/u);
  assert.match(continuity, /PRODUCTION_DELETION_RESURRECTED/u);
  assert.match(continuity, /await tables\.deleteTable/u);
});
