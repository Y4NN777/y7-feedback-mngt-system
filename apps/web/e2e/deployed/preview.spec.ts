import { expect, test } from "@playwright/test";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`DEPLOYED_SMOKE_FIXTURE_MISSING:${name}`);
  return value;
}

async function navigateAcrossTransientNetworkChange(
  navigation: () => Promise<unknown>,
): Promise<void> {
  try {
    await navigation();
  } catch (error: unknown) {
    if (!(error instanceof Error) || !error.message.includes("ERR_NETWORK_CHANGED")) {
      throw error;
    }
    await navigation();
  }
}

test("deployed Preview restores a real team session and serves the created Reporter route", async ({
  page,
}) => {
  const email = required("Y7_SMOKE_EMAIL");
  const password = required("Y7_SMOKE_PASSWORD");
  const workspaceId = required("Y7_SMOKE_WORKSPACE_ID");
  const projectId = required("Y7_SMOKE_PROJECT_ID");
  const operationId = required("Y7_SMOKE_OPERATION_ID");
  const slug = required("Y7_SMOKE_SLUG");

  await navigateAcrossTransientNetworkChange(() => page.goto("/manage"));
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("Session active.", { exact: true })).toBeVisible();

  await page.getByLabel("Identifiant du Workspace").fill(workspaceId);
  await page.getByLabel("Identifiant du projet").fill(projectId);
  await page.getByLabel("Identifiant unique de l’opération").fill(operationId);
  await page.getByLabel("Slug du projet").fill(slug);
  await page.getByLabel("But Reporter en français").fill("Parcours Reporter déployé");
  await page.getByLabel("But Reporter en anglais").fill("Deployed Reporter journey");
  await page.getByRole("button", { name: "Appliquer la commande" }).click();
  await expect(page.getByText("Commande appliquée.")).toBeVisible();

  await navigateAcrossTransientNetworkChange(() => page.reload());
  await expect(page.getByText("Session active.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Adresse e-mail")).toHaveCount(0);

  await navigateAcrossTransientNetworkChange(() => page.goto(`/${slug}`));
  await expect(
    page.getByRole("heading", { name: "Parcours Reporter déployé" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Quel problème avez-vous rencontré ?" })
    .fill("Le parcours Vercel vers Appwrite répond.");
  await page.getByRole("button", { name: "Relire le retour" }).click();
  await expect(
    page.getByRole("heading", { name: "Relire avant de continuer" }),
  ).toBeVisible();
});
