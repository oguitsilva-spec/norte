import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { setupDb, createUser } from "./helpers/db";
import { getDb, schema, closeDb } from "@/server/db";
import { createDemoWorkspace } from "@/server/demo/seed";
import { loadWorkspaceContext, AccessError, getAdAccountInWorkspace, type WorkspaceContext } from "@/server/tenancy/access";
import * as q from "@/server/analytics/queries";
import { getOverview, getExplorer, getCreatives, getFunnels } from "@/server/analytics/dashboard";
import { parseFilters } from "@/lib/filters";
import { todayInTimezone, sumTotals } from "@/lib/metrics/core";

let A: { user: string; ws: string; acc: typeof schema.adAccounts.$inferSelect };
let B: { user: string; ws: string; acc: typeof schema.adAccounts.$inferSelect };
const NOW = new Date("2026-09-24T15:00:00Z");

async function makeTenant(name: string, seed: number) {
  const user = await createUser(name);
  const ws = await createDemoWorkspace(user, { seed, now: NOW, name: `Demo ${name}` });
  const [acc] = await getDb().select().from(schema.adAccounts).where(eq(schema.adAccounts.workspaceId, ws.id));
  return { user, ws: ws.id, acc };
}

const ctxFor = (t: typeof A, role: "owner" | "viewer" = "owner"): WorkspaceContext => ({
  userId: t.user, userName: "x", userEmail: "x@x", workspaceId: t.ws, workspaceName: "WS", isDemo: true, role,
  settings: { roasTarget: 3, cpaTarget: 85, rankingMinResults: 3 }, selectedAdAccountId: null,
});

beforeAll(async () => {
  await setupDb();
  A = await makeTenant("Ana", 1);
  B = await makeTenant("Bruno", 2);
}, 120_000);
afterAll(async () => closeDb());

describe("isolamento entre clientes", () => {
  it("usuário não acessa workspace alheio (404) e viewer não executa ação de admin (403)", async () => {
    await expect(loadWorkspaceContext(A.user, B.ws)).rejects.toMatchObject({ status: 404 });
    await expect(loadWorkspaceContext(A.user, "nao-e-uuid")).rejects.toBeInstanceOf(AccessError);
    await getDb().insert(schema.memberships).values({ workspaceId: B.ws, userId: A.user, role: "viewer" });
    await expect(loadWorkspaceContext(A.user, B.ws, "admin")).rejects.toMatchObject({ status: 403 });
    await expect(loadWorkspaceContext(A.user, B.ws, "viewer")).resolves.toMatchObject({ role: "viewer" });
    await getDb().delete(schema.memberships).where(sql`workspace_id = ${B.ws} and user_id = ${A.user}`);
  });

  it("trocar o ID da conta na URL não vaza dados de outro workspace", async () => {
    expect(await getAdAccountInWorkspace(A.ws, B.acc.id)).toBeNull();
    const today = todayInTimezone("America/Sao_Paulo", NOW);
    const crossed = await q.getTotals({ workspaceId: A.ws, adAccountId: B.acc.id }, { from: "2026-01-01", to: today });
    expect(crossed.rows).toBe(0);
    expect(crossed.spend).toBe(0);
    const own = await q.getTotals({ workspaceId: B.ws, adAccountId: B.acc.id }, { from: "2026-01-01", to: today });
    expect(own.rows).toBeGreaterThan(100);
  });

  it("filtro de campanha com ID de outro cliente não retorna nada (drilldown e totais)", async () => {
    const [bCampaign] = await getDb().select().from(schema.campaigns).where(eq(schema.campaigns.workspaceId, B.ws)).limit(1);
    const f = parseFilters({ periodo: "30d", campanha: bCampaign.id }, todayInTimezone("America/Sao_Paulo", NOW));
    const ex = await getExplorer(ctxFor(A), A.acc, f, { campaignId: bCampaign.id });
    expect(ex.notFound).toBe(true);
    const ov = await getOverview(ctxFor(A), A.acc, f);
    expect(ov.current.rows).toBe(0);
  });

  it("caches são separados por workspace", async () => {
    const f = parseFilters({ periodo: "30d" }, todayInTimezone("America/Sao_Paulo", NOW));
    const a = await getOverview(ctxFor(A), A.acc, f);
    const b = await getOverview(ctxFor(B), B.acc, f);
    expect(a.current.spend).not.toBe(b.current.spend);
    const a2 = await getOverview(ctxFor(A), A.acc, f);
    expect(a2.current.spend).toBe(a.current.spend);
  });
});

describe("consistência dos dados de demonstração e do painel", () => {
  const today = todayInTimezone("America/Sao_Paulo", NOW);

  it("compras extraídas não somam tipos sobrepostos", async () => {
    const [r] = await getDb().execute<{ extracted: number; omni: number; pixel: number }>(sql`
      select sum(purchases)::float8 extracted,
             sum(coalesce((actions->>'omni_purchase')::numeric,0))::float8 omni,
             sum(coalesce((actions->>'offsite_conversion.fb_pixel_purchase')::numeric,0))::float8 pixel
      from insights_daily where ad_account_id = ${A.acc.id}`);
    expect(Number(r.extracted)).toBe(Number(r.omni));
    expect(Number(r.extracted)).toBeGreaterThan(0);
  });

  it("KPIs = totais; série diária soma o total; ROAS vem dos totais", async () => {
    const f = parseFilters({ periodo: "30d" }, today);
    const ov = await getOverview(ctxFor(A), A.acc, f);
    const seriesSpend = ov.series.reduce((s, p) => s + (p.spend ?? 0), 0);
    expect(seriesSpend).toBeCloseTo(ov.current.spend, 2);
    const campSpend = ov.campaigns.reduce((s, c) => s + c.totals.spend, 0);
    expect(campSpend).toBeCloseTo(ov.current.spend, 2);
    expect(ov.kpis.roas.ok && ov.kpis.roas.value).toBeCloseTo(ov.current.purchaseValue / ov.current.spend, 6);
    // período anterior alinhado com a mesma duração
    expect(ov.series.length).toBe(30);
    expect(f.prevTo < f.from).toBe(true);
    // intervalo terminado ontem não inclui o dia parcial
    expect(ov.series.some((p) => p.partial)).toBe(false);
  });

  it("filtro por objetivo muda o resultado principal e restringe as campanhas", async () => {
    const f = parseFilters({ periodo: "30d", objetivo: "messaging" }, today);
    const ov = await getOverview(ctxFor(A), A.acc, f);
    expect(ov.kind).toBe("messaging");
    expect(ov.campaigns.every((c) => c.group === "messaging")).toBe(true);
    const ex = await getExplorer(ctxFor(A), A.acc, f, {});
    expect(ex.rows.every((r) => r.group === "messaging")).toBe(true);
    const cr = await getCreatives(ctxFor(A), A.acc, f, "roas");
    expect(cr.kind).toBe("messaging");
  });

  it("gera alertas com regra explícita (gasto sem compras e meta de ROAS)", async () => {
    const f = parseFilters({ periodo: "14d" }, today);
    const ov = await getOverview(ctxFor(A), A.acc, f);
    const spendNoPurchase = ov.insights.find((i) => i.id.startsWith("spend-no-purchase"));
    expect(spendNoPurchase?.entity?.name).toContain("Teste");
    for (const i of ov.insights) expect(i.rule.length).toBeGreaterThan(5);
  });

  it("ranking respeita limiares e separa dados insuficientes", async () => {
    const f = parseFilters({ periodo: "30d" }, today);
    const cr = await getCreatives(ctxFor(A), A.acc, f, "roas");
    expect(cr.ranked.length).toBeGreaterThan(3);
    for (const a of cr.ranked) {
      expect(a.totals.spend).toBeGreaterThanOrEqual(cr.thresholds.minSpend);
      expect(a.results).toBeGreaterThanOrEqual(cr.thresholds.minResults);
    }
    const roas = cr.ranked.map((a) => (a.kpis.roas.ok ? a.kpis.roas.value : 0));
    expect([...roas].sort((x, y) => y - x)).toEqual(roas);
  });

  it("funil salvo calcula etapas sem limitar taxas", async () => {
    const f = parseFilters({ periodo: "30d" }, today);
    const fn = await getFunnels(ctxFor(A), A.acc, f);
    expect(fn.funnels.length).toBe(1);
    const st = fn.funnels[0].result.stages;
    expect(st.map((s) => s.metric)).toEqual(["impressions", "link_clicks", "landing_page_views", "add_to_cart", "initiate_checkout", "purchases"]);
    expect(st.every((s) => s.value.ok)).toBe(true);
    expect(st.filter((s) => s.isBottleneck).length).toBe(1);
  });

  it("totais por anúncio somam o total da conta (métricas aditivas)", async () => {
    const scope = { workspaceId: A.ws, adAccountId: A.acc.id };
    const range = { from: "2026-08-01", to: "2026-08-31" };
    const total = await q.getTotals(scope, range);
    const byAd = await q.getByAd(scope, range);
    const s = sumTotals([...byAd.values()]);
    expect(s.spend).toBeCloseTo(total.spend, 4);
    expect(s.purchases).toBeCloseTo(total.purchases, 4);
    expect(s.rows).toBe(total.rows);
  });
});
