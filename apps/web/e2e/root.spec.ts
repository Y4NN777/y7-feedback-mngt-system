import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:8787/v1/projects/*", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") {
      await route.abort();
      return;
    }
    const slug = url.pathname.split("/").at(-1);
    if (slug === "wisemoney") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "current",
          slug: "wisemoney",
          purpose: {
            fr: "Partager un retour sur WiseMoney",
            en: "Share feedback about WiseMoney",
          },
        }),
      });
      return;
    }
    if (slug === "wisemoney-legacy") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "redirect",
          canonicalSlug: "wisemoney",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "ERR-PROJECT-UNAVAILABLE" }),
    });
  });
});

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

  await expect(page.getByRole("main")).toHaveAttribute("data-visual-anchor", "swiss");
  const visualTokens = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const brandElement = document.querySelector<HTMLElement>(".brand");
    if (!brandElement) throw new Error("Brand is missing");
    const brand = getComputedStyle(brandElement);
    return {
      accent: brand.backgroundColor,
      radius: brand.borderRadius,
      surface: root.backgroundColor,
      typeface: root.fontFamily,
    };
  });
  expect(visualTokens).toEqual({
    accent: "rgb(0, 47, 167)",
    radius: "0px",
    surface: "rgb(247, 247, 248)",
    typeface: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  });

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
  const serviceWorker = await serviceWorkerResponse.text();
  expect(serviceWorker).not.toContain('"/api/');
  expect(serviceWorker).toContain("clientsClaim");
});

test("BDD-UX-INTAKE-001 reviews a bilingual WiseMoney draft without losing input", async ({
  page,
}) => {
  await page.goto("/wisemoney");

  await expect(
    page.getByRole("heading", { name: "Partager un retour sur WiseMoney" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Partager un retour sur WiseMoney" }),
  ).toHaveAttribute("data-step", "01");
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
  await expect(
    page.getByRole("region", { name: "Review before continuing" }),
  ).toHaveAttribute("data-step", "02");
  await expect(page.getByText("wisemoney", { exact: true })).toBeVisible();
  await expect(page.getByText("Suggestion", { exact: true })).toBeVisible();
  await expect(page.getByText("Ajouter une vue mensuelle.")).toBeVisible();
  await expect(page.getByText("2.4.1")).toBeVisible();
  await expect(page.getByText("No attachments")).toBeVisible();
  await expect(page.getByText(/optional.*follow up/i)).toBeVisible();
});

test("BDD-PROJ-002 redirects a historical Project slug canonically", async ({
  page,
}) => {
  await page.goto("/wisemoney-legacy");

  await expect(page).toHaveURL(/\/wisemoney$/u);
  await expect(
    page.getByRole("heading", { name: "Partager un retour sur WiseMoney" }),
  ).toBeVisible();
});

test("BDD-PROJ-003 keeps unavailable Project routes neutral in FR/EN", async ({
  page,
}) => {
  await page.goto("/unknown-project");

  await expect(
    page.getByRole("heading", { name: "Ce projet n’est pas disponible" }),
  ).toBeVisible();
  await expect(page.getByText(/unknown-project/iu)).toHaveCount(0);
  await page.getByRole("button", { name: "English" }).click();
  await expect(
    page.getByRole("heading", { name: "This project is unavailable" }),
  ).toBeVisible();
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

  await expect(page.getByRole("main")).toHaveAttribute("data-visual-anchor", "swiss");
  await expect(
    page.getByRole("region", { name: "Retrouver un retour" }),
  ).toHaveAttribute("data-step", "01");

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

test("BDD-ADMIN-001 administration sign-in preserves input and is accessible at 320 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/manage");

  await expect(
    page.getByRole("heading", { name: "Administration des projets" }),
  ).toBeVisible();
  await page.getByLabel("Adresse e-mail").fill("owner@example.test");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByLabel("Email address")).toHaveValue("owner@example.test");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});
