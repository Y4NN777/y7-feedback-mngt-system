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
