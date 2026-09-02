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

test("BDD-INT-218 keeps the Intelligence entry screen accessible at 320 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/intelligence");

  await expect(page.getByRole("heading", { name: "Intelligence" })).toBeVisible();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByText(/Analyze feedback inside one Project/u)).toBeVisible();
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

test("BDD-SRC-219 source management entry is bilingual and accessible at 320 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/manage/sources");

  await expect(page.getByRole("heading", { name: "Sources du projet" })).toBeVisible();
  await expect(page.getByLabel("Adresse e-mail")).toBeVisible();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Project sources" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();

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

test("BDD-CONV-001 Reporter answers without Internal Notes in FR/EN at 320 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const commands: unknown[] = [];
  await page.route("http://127.0.0.1:8787/v1/feedback/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/v1/feedback/retrieve") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ok",
          feedback: {
            feedbackId: "feedback_1",
            reference: "Y7-2026-000001",
            originalSource: {
              type: "bug",
              problem: "Le solde est incorrect",
            },
            currentSource: { type: "bug", problem: "Le solde est incorrect" },
            currentState: "awaiting_reporter",
            history: [],
            messages: [],
            attachments: [],
            sourceRevisions: [],
            deletionRequests: [],
          },
        }),
      });
      return;
    }
    if (path.endsWith("/conversation/retrieve")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ok",
          conversation: {
            feedbackId: "feedback_1",
            state: commands.length >= 2 ? "under_review" : "awaiting_reporter",
            messages:
              commands.length >= 1
                ? [
                    {
                      id: "message_answer",
                      actorKind: "reporter",
                      audience: "reporter",
                      occurredAt: "2026-08-28T12:02:00.000Z",
                      content: "Version 2.1",
                    },
                  ]
                : [
                    {
                      id: "message_question",
                      actorKind: "workspace",
                      audience: "reporter",
                      occurredAt: "2026-08-28T12:00:00.000Z",
                      content: "Quelle version est concernée ?",
                    },
                  ],
            lifecycle: [
              {
                id: "event_question",
                priorState: "under_review",
                state: "awaiting_reporter",
                actorKind: "workspace",
                occurredAt: "2026-08-28T12:01:00.000Z",
                reason: "Version requise",
                sequence: 3,
              },
            ],
          },
        }),
      });
      return;
    }
    if (path.endsWith("/conversation/commands")) {
      commands.push(request.postDataJSON());
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ status: "applied" }),
      });
      return;
    }
    await route.abort();
  });

  await page.goto("/retrieve");
  await page.getByRole("textbox", { name: "Référence" }).fill("Y7-2026-000001");
  await page.getByLabel("Preuve d’accès").fill("private-proof");
  await page.getByRole("button", { name: "Retrouver le retour" }).click();
  await expect(page.getByText("Quelle version est concernée ?")).toBeVisible();
  await expect(page.getByText(/note interne/u)).toHaveCount(0);
  await page.getByRole("textbox", { name: "Votre réponse" }).fill("Version 2.1");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("textbox", { name: "Your answer" })).toHaveValue(
    "Version 2.1",
  );
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByRole("status")).toContainText("Answer recorded");
  expect(commands).toHaveLength(2);
  await expect(page).not.toHaveURL(/private-proof/u);

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

test("BDD-WORK-001 Workbench detail is keyboard-complete and accessible at 320 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.route("http://127.0.0.1/v1/account/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(path.endsWith("/jwts") ? { jwt: "jwt_1" } : {}),
    });
  });
  await page.route("http://127.0.0.1:8787/v1/workspaces/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const conversation = path.endsWith("/conversation");
    const detail = path.endsWith("/workbench/feedback_1");
    const result = detail
      ? {
          feedbackId: "feedback_1",
          type: "bug",
          state: "under_review",
          acceptedAt: "2026-08-28T10:00:00.000Z",
          assignedPrincipalIds: ["maintainer_1"],
          source: { type: "bug", problem: "Upload fails" },
          context: [],
          attachmentNames: [],
          classification: "Performance",
          assignedMaintainerId: "maintainer_1",
        }
      : [
          {
            feedbackId: "feedback_1",
            type: "bug",
            state: "under_review",
            acceptedAt: "2026-08-28T10:00:00.000Z",
            assignedPrincipalIds: ["maintainer_1"],
          },
        ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        conversation
          ? {
              status: "ok",
              conversation: {
                feedbackId: "feedback_1",
                state: "under_review",
                messages: [],
                internalNotes: [
                  {
                    id: "note_1",
                    actorKind: "workspace",
                    audience: "workspace",
                    occurredAt: "2026-08-28T10:01:00.000Z",
                    content: "Internal evidence",
                  },
                ],
                lifecycle: [],
              },
            }
          : { status: "ok", result },
      ),
    });
  });
  await page.goto("/workbench");
  await page.getByLabel("Adresse e-mail").fill("owner@example.test");
  await page.getByLabel("Mot de passe").fill("password");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByLabel("Identifiant du Workspace").fill("workspace_1");
  await page.getByLabel("Identifiant du projet").fill("project_1");
  await page.getByRole("button", { name: "Ouvrir la boîte" }).click();
  const feedback = page.getByRole("button", { name: /feedback_1/u });
  await expect(feedback).toBeVisible();
  await feedback.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Upload fails" })).toBeVisible();
  await expect(page.getByText("Internal evidence")).toBeVisible();
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
