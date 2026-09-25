import { test, expect } from "@playwright/test";

test("troca de workspace pelo menu e criação de demo pelo menu", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/criar-conta");
  await page.fill("#name", "Troca");
  await page.fill("#email", `troca${Date.now()}@norte.dev`);
  await page.fill("#password", "senha-muito-segura-1");
  await page.click("button[type=submit]");
  await page.waitForURL(/visao-geral/);
  const real = page.url();

  // cria demo pelo menu do workspace
  await page.locator("aside").getByRole("button").first().click();
  await page.getByRole("menuitem", { name: /Novo workspace de demonstração/ }).click();
  await page.waitForURL((u) => u.toString() !== real && /visao-geral/.test(u.toString()), { timeout: 60_000 });
  await expect(page.getByText("Modo demonstração:", { exact: true }).first()).toBeVisible();

  // volta para o workspace real pelo menu
  await page.locator("aside").getByRole("button").first().click();
  await page.getByRole("menuitem", { name: /Workspace de Troca/ }).click();
  await page.waitForURL((u) => u.toString().split("/w/")[1]?.split("/")[0] === real.split("/w/")[1].split("/")[0], { timeout: 30_000 });
  await expect(page.getByText("Modo demonstração:", { exact: true })).toHaveCount(0);
});
