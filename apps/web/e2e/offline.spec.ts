import { expect, test, type Page } from "@playwright/test";

async function routeProject(page: Page) {
  await page.route("http://127.0.0.1:8787/v1/projects/*", async (route) => {
    if (route.request().method() !== "GET") {
      await route.abort();
      return;
    }
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
  });
}

test("BDD-OFF-E2E-001 survives reload and navigation offline without protected caches", async ({
  context,
  page,
}) => {
  await routeProject(page);
  await page.goto("/wisemoney");
  await expect(
    page.getByRole("heading", { name: "Partager un retour sur WiseMoney" }),
  ).toBeVisible();
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Partager un retour sur WiseMoney" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Quel problème avez-vous rencontré ?" })
    .fill("Brouillon durable hors ligne");
  await expect(page.getByText("Brouillon enregistré sur cet appareil.")).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Partager un retour sur WiseMoney" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Quel problème avez-vous rencontré ?" }),
  ).toHaveValue("Brouillon durable hors ligne");
  await expect(
    page.getByText("Brouillon hors ligne restauré sur cet appareil."),
  ).toBeVisible();
  await page.getByRole("button", { name: "English" }).click();
  await expect(
    page.getByRole("textbox", { name: "What problem did you encounter?" }),
  ).toHaveValue("Brouillon durable hors ligne");
  const cachedUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      urls.push(...(await cache.keys()).map(({ url }) => url));
    }
    return urls;
  });
  expect(cachedUrls.length).toBeGreaterThan(0);
  expect(cachedUrls).not.toEqual(
    expect.arrayContaining([
      expect.stringMatching(/\/v1\//u),
      expect.stringMatching(/\/retrieve(?:\?|$)/u),
      expect.stringMatching(/\/workbench(?:\?|$)/u),
      expect.stringMatching(/\/manage(?:\/|\?|$)/u),
    ]),
  );
  await context.setOffline(false);
});

test("BDD-OFF-E2E-002 reports quota failure without losing in-memory input", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // The test deliberately preserves and invokes the native method with its runtime receiver.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...arguments_: Parameters<typeof original>
    ) {
      if (this.name === "drafts") throw new DOMException("quota", "QuotaExceededError");
      return original.apply(this, arguments_);
    };
  });
  await routeProject(page);
  await page.goto("/wisemoney");
  const problem = page.getByRole("textbox", {
    name: "Quel problème avez-vous rencontré ?",
  });
  await problem.fill("Saisie conservée en mémoire");
  await expect(page.getByRole("alert")).toContainText(
    "Le stockage hors ligne est indisponible",
  );
  await expect(problem).toHaveValue("Saisie conservée en mémoire");
});
