import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

async function signUp(page: Page, name: string) {
  const email = `${name.toLowerCase()}${Date.now()}${Math.floor(Math.random() * 1e4)}@norte.dev`;
  await page.goto("/criar-conta");
  await page.fill("#name", name);
  await page.fill("#email", email);
  await page.fill("#password", "senha-muito-segura-1");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/w\/[0-9a-f-]+\/visao-geral/);
  return email;
}

async function openDemo(page: Page) {
  const before = page.url();
  await page.getByRole("button", { name: /modo demonstração/i }).first().click();
  await page.waitForURL((u) => u.toString() !== before && /visao-geral/.test(u.toString()));
  return page.url().match(/\/w\/([0-9a-f-]+)\//)![1];
}

test("fluxo: cadastro → demonstração → painel com KPIs e selo de demo", async ({ page }) => {
  await signUp(page, "Ana");
  await expect(page.getByRole("heading", { name: /Integração com a Meta ainda não configurada|Conecte suas contas/ })).toBeVisible();
  await openDemo(page);
  await expect(page.getByText("Modo demonstração:", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Resumo" }).getByText("ROAS", { exact: true })).toBeVisible();
  const kpis = page.getByRole("region", { name: "Indicadores" });
  for (const l of ["Vendas", "Receita atribuída", "Investimento", "Custo por venda"]) await expect(kpis.getByText(l, { exact: true })).toBeVisible();
  // Recomendações priorizadas aparecem na visão geral, com acesso à lista completa
  await expect(page.getByRole("heading", { name: "O que merece atenção" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Ver todas/ })).toBeVisible();
  // Status da recomendação é persistido por workspace
  await page.getByRole("button", { name: "Marcar como revisada" }).first().click();
  const recsUrl = page.url().replace("visao-geral", "recomendacoes");
  await expect(async () => {
    await page.goto(recsUrl);
    await expect(page.getByRole("tab", { name: /Revisadas\s*1/ })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  // Filtros globais vão para a URL e persistem entre telas
  await page.getByRole("button", { name: "Período" }).click();
  await page.getByRole("option", { name: "Últimos 7 dias" }).click();
  await page.waitForURL(/periodo=7d/);
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Campanhas" }).click();
  await page.waitForURL(/campanhas\?.*periodo=7d/);
  await expect(page.getByRole("table")).toBeVisible();
});

test("isolamento: outro cliente não acessa workspace, exportação nem status trocando IDs", async ({ browser }) => {
  const a = await browser.newPage();
  await signUp(a, "Alice");
  const wsA = await openDemo(a);
  const accA = await a.locator("select").first().inputValue();

  const b = await browser.newPage();
  await signUp(b, "Bruno");
  for (const path of [`/w/${wsA}/visao-geral`, `/w/${wsA}/campanhas`, `/w/${wsA}/conexoes`, `/w/${wsA}/configuracoes`]) {
    const r = await b.goto(path);
    expect(r?.status(), path).toBe(404);
  }
  const req: APIRequestContext = b.context().request;
  expect((await req.get(`/api/w/${wsA}/export?conta=${accA}`)).status()).toBe(404);
  expect((await req.get(`/api/w/${wsA}/status?conta=${accA}`)).status()).toBe(404);
  // conta de A pedida dentro do workspace de B é ignorada (resolve para a conta própria ou nenhuma)
  const wsB = b.url().match(/\/w\/([0-9a-f-]+)\//)![1];
  const exp = await req.get(`/api/w/${wsB}/export?conta=${accA}`);
  expect(exp.status()).toBe(404);
  // sem sessão: redireciona para o login
  const anon = await browser.newPage();
  await anon.goto(`/w/${wsA}/visao-geral`);
  await expect(anon).toHaveURL(/\/entrar/);
});

test("teclado: navegação principal é acessível por Tab", async ({ page }) => {
  await signUp(page, "Caio");
  await openDemo(page);
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(["A", "BUTTON", "SELECT", "INPUT"]).toContain(focused);
});

test("recuperação de senha: link de uso único redefine e encerra sessões", async ({ page, browser }) => {
  const email = await signUp(page, "Duda");
  const anon = await browser.newPage();
  await anon.goto("/recuperar-senha");
  await anon.fill("#email", email);
  await anon.click("button[type=submit]");
  await expect(anon.getByRole("heading", { name: "Verifique seu e-mail" })).toBeVisible();
  // Em desenvolvimento, sem SMTP, o e-mail fica no outbox; lemos o link direto do banco de teste.
  const { execSync } = await import("node:child_process");
  const body = execSync(`PGPASSWORD=postgres psql -h localhost -U postgres painel -Atc "select body from mail_outbox where \\"to\\"='${email}' order by created_at desc limit 1"`).toString();
  const link = body.match(/https?:\/\/\S+/)![0];
  await anon.goto(link);
  await anon.waitForURL(/redefinir-senha\?token=/);
  await anon.fill("#password", "nova-senha-segura-22");
  await anon.fill("#confirm", "nova-senha-segura-22");
  await anon.click("button[type=submit]");
  await anon.waitForURL(/entrar/);
  // link não pode ser reutilizado
  await anon.goto(link);
  await expect(anon).toHaveURL(/error=INVALID_TOKEN|redefinir-senha\?error/);
  await anon.goto("/entrar");
  await anon.fill("#email", email);
  await anon.fill("#password", "nova-senha-segura-22");
  await anon.click("button[type=submit]");
  await anon.waitForURL(/visao-geral/);
  // a sessão antiga (aberta antes da redefinição) foi revogada
  await page.reload();
  await expect(page).toHaveURL(/entrar/);
});
