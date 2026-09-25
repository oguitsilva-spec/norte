import { describe, expect, it } from "vitest";
import { buildRecommendations, REC, type RecInput } from "@/lib/metrics/recommendations";
import { ALL_TRACKED, ZERO_TOTALS, type Totals } from "@/lib/metrics/core";

const T = (p: Partial<Totals>): Totals => ({ ...ZERO_TOTALS, rows: 30, ...p });

function base(over: Partial<RecInput> = {}): RecInput {
  return {
    currency: "BRL",
    period: { from: "2026-08-01", to: "2026-08-30" },
    previous: { from: "2026-07-02", to: "2026-07-31" },
    today: "2026-09-20",
    reconciliationDays: 7,
    kind: "purchases",
    tracking: ALL_TRACKED,
    targets: {},
    account: {
      current: T({ spend: 10000, impressions: 500000, linkClicks: 6000, landingPageViews: 5000, initiateCheckout: 900, purchases: 200, purchaseValue: 30000 }),
      previous: T({ spend: 9000, impressions: 480000, linkClicks: 5800, landingPageViews: 4800, initiateCheckout: 850, purchases: 190, purchaseValue: 29000 }),
    },
    campaigns: [],
    ads: [],
    winners: [],
    ...over,
  };
}
const rules = (o: ReturnType<typeof buildRecommendations>) => o.items.map((i) => i.rule);

describe("recomendações (Growth OS)", () => {
  it("sem investimento: nenhuma recomendação e motivo explícito", () => {
    const o = buildRecommendations(base({ account: { current: ZERO_TOTALS, previous: ZERO_TOTALS } }));
    expect(o.items).toHaveLength(0);
    expect(o.skipped[0].reason).toMatch(/Sem investimento/);
  });

  it("funil de baixo para cima: o gargalo mais próximo da venda é o principal", () => {
    // CTR 0,5% (< 0,8%) e taxa de compra 5% (< 10%): a de compra é a principal.
    const o = buildRecommendations(
      base({ account: { current: T({ spend: 10000, impressions: 1_000_000, linkClicks: 5000, landingPageViews: 4500, initiateCheckout: 1000, purchases: 50, purchaseValue: 9000 }), previous: T({ spend: 9000 }) } }),
    );
    const purchase = o.items.find((i) => i.rule === "funnel_purchase_rate")!;
    const ctr = o.items.find((i) => i.rule === "funnel_ctr")!;
    expect(purchase.priority).toBe("alta");
    expect(ctr.priority).toBe("media");
    expect(purchase.nature).toBe("hipotese");
    expect(purchase.analysis.limitations.join(" ")).toMatch(/agregadas/);
  });

  it("volume abaixo do mínimo: não dispara e registra 'Dados insuficientes'", () => {
    const o = buildRecommendations(base({ account: { current: T({ spend: 500, impressions: 3000, linkClicks: 10, landingPageViews: 5, initiateCheckout: 3, purchases: 0 }), previous: T({}) } }));
    expect(rules(o)).not.toContain("funnel_ctr");
    expect(rules(o)).not.toContain("funnel_purchase_rate");
    expect(o.skipped.some((s) => /Dados insuficientes/.test(s.reason))).toBe(true);
  });

  it("evento não rastreado não vira taxa zero", () => {
    const o = buildRecommendations(base({ tracking: { ...ALL_TRACKED, initiateCheckout: false, landingPageView: false } }));
    expect(rules(o)).not.toContain("funnel_purchase_rate");
    expect(rules(o)).not.toContain("funnel_checkout_rate");
    expect(rules(o)).not.toContain("funnel_connect_rate");
  });

  it("CPA subindo ≥ 20% com volume nos dois períodos → reduzir e testar criativos", () => {
    const c = { id: "c1", name: "[Vendas] Frio", status: "ACTIVE", group: "sales" as const, current: T({ spend: 3000, purchases: 20, purchaseValue: 6000 }), previous: T({ spend: 2000, purchases: 20, purchaseValue: 6000 }) };
    const o = buildRecommendations(base({ campaigns: [c] }));
    const r = o.items.find((i) => i.rule === "cpa_rising")!;
    expect(r.entity.id).toBe("c1");
    expect(r.action).toMatch(/Reduzir o orçamento/);
    expect(r.analysis.comparison).toMatch(/mesmo número de dias/);
  });

  it("escala exige meta do usuário; sem meta sugere definir metas", () => {
    const c = { id: "c1", name: "[Vendas] Quente", status: "ACTIVE", group: "sales" as const, current: T({ spend: 1000, purchases: 20, purchaseValue: 5000 }), previous: T({ spend: 1000, purchases: 19, purchaseValue: 4800 }) };
    const noTarget = buildRecommendations(base({ campaigns: [c] }));
    expect(rules(noTarget)).not.toContain("scale_opportunity");
    expect(rules(noTarget)).toContain("define_targets");
    const withTarget = buildRecommendations(base({ campaigns: [c], targets: { roas: 3 } }));
    const s = withTarget.items.find((i) => i.rule === "scale_opportunity")!;
    expect(s.action).toMatch(/20–30%/);
    expect(s.analysis.limitations.join(" ")).toMatch(/Não há projeção/);
  });

  it("período curto (< 7 dias) desliga tendência, escala e desgaste", () => {
    const c = { id: "c1", name: "X", status: "ACTIVE", group: "sales" as const, current: T({ spend: 3000, purchases: 20, purchaseValue: 6000 }), previous: T({ spend: 2000, purchases: 20, purchaseValue: 6000 }) };
    const o = buildRecommendations(base({ period: { from: "2026-08-28", to: "2026-08-30" }, previous: { from: "2026-08-25", to: "2026-08-27" }, campaigns: [c] }));
    expect(rules(o)).not.toContain("cpa_rising");
    expect(o.skipped.some((s) => s.rule === "Tendência e escala")).toBe(true);
  });

  it("dias ainda em reconciliação geram ressalva", () => {
    const o = buildRecommendations(base({ period: { from: "2026-08-22", to: "2026-09-20" }, today: "2026-09-20" }));
    expect(o.caveats.join(" ")).toMatch(/conversões atrasadas/);
    expect(o.caveats.join(" ")).toMatch(/hoje/);
  });

  it("anúncio com gasto alto sem resultado e desgaste por queda de CTR", () => {
    const ads = [
      { id: "a1", name: "Estático A", status: "ACTIVE", campaignId: "c", campaignName: "C", group: "sales" as const, current: T({ spend: 200, impressions: 8000, linkClicks: 80, purchases: 0 }), previous: T({}) },
      { id: "a2", name: "Vídeo B", status: "ACTIVE", campaignId: "c", campaignName: "C", group: "sales" as const, current: T({ spend: 900, impressions: 40000, linkClicks: 200, purchases: 10 }), previous: T({ spend: 800, impressions: 40000, linkClicks: 400, purchases: 16 }) },
    ];
    const o = buildRecommendations(base({ ads }));
    expect(o.items.find((i) => i.rule === "spend_no_results_ad")?.entity.id).toBe("a1");
    const f = o.items.find((i) => i.rule === "creative_fatigue")!;
    expect(f.entity.id).toBe("a2");
    expect(f.nature).toBe("hipotese");
    // Menos de 6 anúncios ativos
    expect(rules(o)).toContain("creative_volume");
    expect(REC.minActiveAds).toBe(6);
  });

  it("compras sem valor e compras não rastreadas são alta prioridade", () => {
    const o = buildRecommendations(base({ account: { current: T({ spend: 1000, impressions: 1000, purchases: 10, purchaseValue: 0 }), previous: T({}) } }));
    expect(o.items[0].rule).toBe("tracking_revenue");
    const c = { id: "c1", name: "Vendas", status: "ACTIVE", group: "sales" as const, current: T({ spend: 500 }), previous: T({}) };
    const nt = buildRecommendations(base({ tracking: { ...ALL_TRACKED, purchase: false }, campaigns: [c] }));
    expect(nt.items[0].rule).toBe("tracking_purchase");
  });

  it("remarketing é hipótese baseada no nome das campanhas", () => {
    const frio = { id: "c1", name: "[Vendas] Prospecção", status: "ACTIVE", group: "sales" as const, current: T({ spend: 5000, purchases: 100 }), previous: T({}) };
    const rmkt = { id: "c2", name: "[Vendas] Remarketing 30 dias", status: "ACTIVE", group: "sales" as const, current: T({ spend: 500, purchases: 30 }), previous: T({}) };
    expect(rules(buildRecommendations(base({ campaigns: [frio] })))).toContain("remarketing_missing");
    expect(rules(buildRecommendations(base({ campaigns: [frio, rmkt] })))).not.toContain("remarketing_missing");
  });

  it("chaves estáveis e ordenação por prioridade", () => {
    const o = buildRecommendations(base({ account: { current: T({ spend: 10000, impressions: 1_000_000, linkClicks: 5000, landingPageViews: 4500, initiateCheckout: 1000, purchases: 50, purchaseValue: 9000 }), previous: T({}) } }));
    const order = { alta: 0, media: 1, baixa: 2 } as const;
    for (let k = 1; k < o.items.length; k++) expect(order[o.items[k - 1].priority]).toBeLessThanOrEqual(order[o.items[k].priority]);
    expect(new Set(o.items.map((i) => i.key)).size).toBe(o.items.length);
  });
});
