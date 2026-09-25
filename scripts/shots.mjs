// Captura telas reais do app (uso: node scripts/shots.mjs <outDir>)
import { chromium } from "@playwright/test";
const out = process.argv[2] ?? "shots";
const base = process.env.BASE ?? "http://localhost:3000";
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo", colorScheme: process.env.SCHEME ?? "light" });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text()); });
const email = `teste${Date.now()}@norte.dev`;
await page.goto(`${base}/criar-conta`);
await page.fill("#name", "Marina Duarte");
await page.fill("#email", email);
await page.fill("#password", "senha-muito-segura-1");
await page.click("button[type=submit]");
await page.waitForURL(/visao-geral/, { timeout: 60000 });
await page.screenshot({ path: `${out}/01-empty.png`, fullPage: true });
const first = page.url();
await page.getByRole("button", { name: /modo demonstração/i }).first().click();
await page.waitForURL((u) => u.toString() !== first && /visao-geral/.test(u.toString()), { timeout: 60000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/02-overview.png`, fullPage: true });
await page.screenshot({ path: `${out}/02b-overview-fold.png` });
const url = page.url();
for (const [name, path] of [["03-campanhas", "campanhas"], ["04-criativos", "criativos"], ["05-funis", "funis"], ["06-conexoes", "conexoes"], ["07-config", "configuracoes"], ["08-metricas", "metricas"]]) {
  const u = url.replace("visao-geral", path);
  const r = await page.goto(u);
  await page.waitForTimeout(1500);
  console.log(name, r?.status());
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "pt-BR", colorScheme: process.env.SCHEME ?? "light", storageState: await ctx.storageState() });
const mp = await m.newPage();
await mp.goto(url);
await mp.waitForTimeout(2500);
await mp.screenshot({ path: `${out}/09-mobile.png`, fullPage: true });
console.log("URL", url, "EMAIL", email);
await browser.close();
