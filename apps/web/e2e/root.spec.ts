import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

function isWebManifest(value: unknown): value is { readonly display: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "display" in value &&
    typeof value.display === "string"
  );
}

test("BDD-ROOT-001/002 presents both root locales without Project enumeration", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Donner un avis" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Retrouver un avis" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Espace équipe" })).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.getByText("WiseMoney")).toHaveCount(0);

  await page.getByRole("button", { name: "English" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Give feedback" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("BDD-UX-001 has no serious accessibility issue or horizontal overflow", async ({
  page,
}) => {
  await page.goto("/");

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const seriousViolations = accessibility.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(seriousViolations).toEqual([]);
  expect(hasHorizontalOverflow).toBe(false);
});

test("BDD-PWA-001 emits a manifest and a public-only service worker", async ({
  request,
}) => {
  const manifestResponse = await request.get("/manifest.webmanifest");
  const serviceWorkerResponse = await request.get("/sw.js");

  expect(manifestResponse.ok()).toBe(true);
  const manifest: unknown = await manifestResponse.json();
  expect(isWebManifest(manifest)).toBe(true);
  if (!isWebManifest(manifest)) {
    throw new Error("The generated web manifest has no display mode");
  }
  expect(manifest.display).toBe("standalone");
  expect(serviceWorkerResponse.ok()).toBe(true);
  expect(await serviceWorkerResponse.text()).not.toContain('"/api/');
});

test("BDD-UX-INTAKE-001 reviews a bilingual WiseMoney draft without losing input", async ({
  page,
}) => {
  await page.goto("/wisemoney");

  await expect(
    page.getByRole("heading", { name: "Partager un retour sur WiseMoney" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Suggestion" }).focus();
  await page.keyboard.press("Space");
  await page
    .getByRole("textbox", { name: "Que proposez-vous ?" })
    .fill("Ajouter une vue mensuelle.");
  await page
    .getByRole("textbox", { name: "Pourquoi serait-ce utile ?" })
    .fill("Pour comprendre les variations.");
  await page
    .getByRole("textbox", { name: "Version de l’application (facultatif)" })
    .fill("2.4.1");

  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("textbox", { name: "What do you propose?" })).toHaveValue(
    "Ajouter une vue mensuelle.",
  );
  await page.getByRole("button", { name: "Review feedback" }).click();

  await expect(
    page.getByRole("heading", { name: "Review before continuing" }),
  ).toBeVisible();
  await expect(page.getByText("WiseMoney", { exact: true })).toBeVisible();
  await expect(page.getByText("Suggestion", { exact: true })).toBeVisible();
  await expect(page.getByText("Ajouter une vue mensuelle.")).toBeVisible();
  await expect(page.getByText("2.4.1")).toBeVisible();
  await expect(page.getByText("No attachments")).toBeVisible();
  await expect(page.getByText(/optional.*follow up/i)).toBeVisible();
});

test("BDD-UX-INTAKE-001 is accessible without overflow at 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/wisemoney");

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const seriousViolations = accessibility.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(seriousViolations).toEqual([]);
  expect(hasHorizontalOverflow).toBe(false);
});

test("BDD-ACC-UX-001 preserves private retrieval input and fails honestly without an API", async ({
  page,
}) => {
  await page.goto("/retrieve");

  await page.getByRole("textbox", { name: "Référence" }).fill("Y7-2026-000001");
  await page
    .getByLabel("Preuve d’accès")
    .fill("proof_A_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("textbox", { name: "Reference" })).toHaveValue(
    "Y7-2026-000001",
  );
  await expect(page.getByLabel("Access proof")).toHaveValue(
    "proof_A_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
  );

  await page.getByRole("button", { name: "Retrieve feedback" }).click();
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page).not.toHaveURL(/proof_A/u);
});

test("BDD-ACC-UX-001 retrieval is accessible without overflow at 320 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/retrieve");

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const seriousViolations = accessibility.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(seriousViolations).toEqual([]);
  expect(hasHorizontalOverflow).toBe(false);
});
