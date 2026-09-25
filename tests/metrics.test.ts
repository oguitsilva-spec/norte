import { describe, it, expect } from "vitest";
import { sumTotals, deriveKpis, ratio, delta, previousPeriod, resolvePreset, todayInTimezone, ZERO_TOTALS, type Totals } from "@/lib/metrics/core";
import { actionListToRecord, chooseActionTypeMap, extractAll, trackingFromMap, objectiveGroup } from "@/lib/metrics/actions";
import { computeFunnel, rankAds, buildInsights, defaultThresholds, FUNNEL_TEMPLATES } from "@/lib/metrics/analysis";
import { fmtCurrency, fmtRoas } from "@/lib/format";

const T = (p: Partial<Totals>): Totals => ({ ...ZERO_TOTALS, rows: 1, ...p });

describe("fórmulas de KPI", () => {
  it("calcula ROAS, CPA, ticket médio, CTR, CPC e CPM a partir dos totais", () => {
    const k = deriveKpis(T({ spend: 1000, purchaseValue: 4000, purchases: 20, impressions: 100000, linkClicks: 1500 }));
    expect(k.roas).toEqual({ ok: true, value: 4 });
    expect(k.costPerPurchase).toEqual({ ok: true, value: 50 });
    expect(k.averageOrderValue).toEqual({ ok: true, value: 200 });
    expect(k.ctr).toEqual({ ok: true, value: 1.5 });
    expect(k.cpc.ok && k.cpc.value).toBeCloseTo(0.6667, 3);
    expect(k.cpm).toEqual({ ok: true, value: 10 });
  });

  it("denominador zero vira indisponível, nunca 0/Infinity/NaN", () => {
    const k = deriveKpis(T({ spend: 0, purchases: 0, impressions: 0 }));
    expect(k.roas).toEqual({ ok: false, reason: "zero_denominator" });
    expect(k.costPerPurchase).toEqual({ ok: false, reason: "zero_denominator" });
    expect(k.cpm).toEqual({ ok: false, reason: "zero_denominator" });
    expect(ratio(5, 0)).toEqual({ ok: false, reason: "zero_denominator" });
  });

  it("distingue sem dados (nenhuma linha) de zero genuíno", () => {
    expect(deriveKpis(sumTotals([])).spend).toEqual({ ok: false, reason: "no_data" });
    expect(deriveKpis(T({ spend: 0 })).spend).toEqual({ ok: true, value: 0 });
  });

  it("evento não rastreado é diferente de zero", () => {
    const k = deriveKpis(T({ spend: 100 }), { purchase: false, lead: true, messaging: false, landingPageView: true, addToCart: false, initiateCheckout: false });
    expect(k.purchases).toEqual({ ok: false, reason: "not_tracked" });
    expect(k.roas).toEqual({ ok: false, reason: "not_tracked" });
    expect(k.leads).toEqual({ ok: true, value: 0 });
  });

  it("ROAS agregado NÃO é a média dos ROAS das campanhas", () => {
    const a = T({ spend: 100, purchaseValue: 1000 }); // ROAS 10
    const b = T({ spend: 900, purchaseValue: 900 }); // ROAS 1
    const total = deriveKpis(sumTotals([a, b]));
    expect(total.roas).toEqual({ ok: true, value: 1.9 }); // 1900/1000, não (10+1)/2 = 5.5
  });

  it("variação percentual com base zero é nula", () => {
    expect(delta({ ok: true, value: 10 }, { ok: true, value: 0 })).toEqual({ ok: true, abs: 10, pct: null });
    expect(delta({ ok: true, value: 12 }, { ok: true, value: 10 })).toEqual({ ok: true, abs: 2, pct: 20 });
    expect(delta({ ok: false, reason: "no_data" }, { ok: true, value: 10 })).toEqual({ ok: false });
  });
});

describe("ações da Meta", () => {
  it("não soma tipos de compra sobrepostos", () => {
    const rec = actionListToRecord([
      { action_type: "omni_purchase", value: "5" },
      { action_type: "purchase", value: "5" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "5" },
      { action_type: "onsite_web_purchase", value: "5" },
    ]);
    const map = chooseActionTypeMap(new Set(Object.keys(rec)));
    expect(map.purchase).toBe("omni_purchase");
    const vals = actionListToRecord([
      { action_type: "omni_purchase", value: "500.5" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "500.5" },
    ]);
    const ex = extractAll(rec, vals, map);
    expect(ex.purchases).toBe(5);
    expect(ex.purchaseValue).toBe(500.5);
  });

  it("usa o pixel quando omni_purchase não existe e mantém a escolha estável", () => {
    const m1 = chooseActionTypeMap(new Set(["offsite_conversion.fb_pixel_purchase"]));
    expect(m1.purchase).toBe("offsite_conversion.fb_pixel_purchase");
    const m2 = chooseActionTypeMap(new Set(["omni_purchase", "offsite_conversion.fb_pixel_purchase"]), m1);
    expect(m2.purchase).toBe("omni_purchase"); // tipo de maior prioridade apareceu -> atualiza
    const m3 = chooseActionTypeMap(new Set(["offsite_conversion.fb_pixel_purchase"]), m2);
    expect(m3.purchase).toBe("omni_purchase"); // não rebaixa por ausência momentânea
  });

  it("conta sem evento de compra fica como não rastreada", () => {
    const map = chooseActionTypeMap(new Set(["link_click", "lead"]));
    expect(map.purchase).toBeNull();
    expect(trackingFromMap(map).purchase).toBe(false);
    expect(trackingFromMap(map).lead).toBe(true);
  });

  it("classifica objetivos, incluindo campanhas de mensagem", () => {
    expect(objectiveGroup("OUTCOME_SALES")).toBe("sales");
    expect(objectiveGroup("OUTCOME_ENGAGEMENT", ["WHATSAPP"])).toBe("messaging");
    expect(objectiveGroup("OUTCOME_LEADS")).toBe("leads");
    expect(objectiveGroup("OUTCOME_AWARENESS")).toBe("awareness");
    expect(objectiveGroup("CONVERSIONS")).toBe("sales");
  });
});

describe("datas e períodos", () => {
  it("período anterior tem a mesma duração e é contíguo", () => {
    expect(previousPeriod("2026-09-01", "2026-09-30")).toEqual({ from: "2026-08-02", to: "2026-08-31" });
    expect(previousPeriod("2026-03-01", "2026-03-07")).toEqual({ from: "2026-02-22", to: "2026-02-28" });
  });
  it("presets terminam ontem no fuso da conta", () => {
    expect(resolvePreset("7d", "2026-09-24")).toEqual({ from: "2026-09-17", to: "2026-09-23" });
    expect(resolvePreset("last_month", "2026-03-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(resolvePreset("mtd", "2026-09-01")).toEqual({ from: "2026-09-01", to: "2026-09-01" });
  });
  it("'hoje' respeita o fuso da conta", () => {
    const instant = new Date("2026-09-25T02:30:00Z"); // 23:30 de 24/09 em São Paulo
    expect(todayInTimezone("America/Sao_Paulo", instant)).toBe("2026-09-24");
    expect(todayInTimezone("Asia/Tokyo", instant)).toBe("2026-09-25");
    expect(todayInTimezone("America/Los_Angeles", instant)).toBe("2026-09-24");
  });
});

describe("funil agregado", () => {
  const tracking = { purchase: true, lead: false, messaging: false, landingPageView: true, addToCart: true, initiateCheckout: true };
  it("não força queda nem limita taxas a 100%", () => {
    const cur = T({ impressions: 1000, linkClicks: 50, landingPageViews: 40, addToCart: 60, initiateCheckout: 20, purchases: 10 });
    const f = computeFunnel(FUNNEL_TEMPLATES.ecommerce.stages, cur, T({}), tracking);
    const atc = f.stages.find((s) => s.metric === "add_to_cart")!;
    expect(atc.rateFromPrev).toEqual({ ok: true, value: 150 });
    expect(atc.exceedsPrev).toBe(true);
    expect(atc.dropOff).toBeNull();
    expect(f.warnings.some((w) => w.includes("não foi limitada a 100%"))).toBe(true);
  });
  it("etapa não rastreada aparece como indisponível, sem inventar valores", () => {
    const cur = T({ impressions: 1000, linkClicks: 50, landingPageViews: 40, purchases: 3 });
    const f = computeFunnel(FUNNEL_TEMPLATES.ecommerce.stages, cur, T({}), { ...tracking, addToCart: false });
    const atc = f.stages.find((s) => s.metric === "add_to_cart")!;
    expect(atc.value).toEqual({ ok: false, reason: "not_tracked" });
    expect(f.warnings.some((w) => w.includes("não é rastreada"))).toBe(true);
  });
  it("marca o maior gargalo pós-clique (impressão→clique é o CTR, não conta)", () => {
    const cur = T({ impressions: 10000, linkClicks: 100, landingPageViews: 90, addToCart: 30, initiateCheckout: 20, purchases: 10 });
    const f = computeFunnel(FUNNEL_TEMPLATES.ecommerce.stages, cur, T({}), tracking);
    expect(f.stages.find((s) => s.isBottleneck)?.metric).toBe("add_to_cart");
  });
});

describe("ranking de anúncios", () => {
  const tracking = { purchase: true, lead: true, messaging: true, landingPageView: true, addToCart: true, initiateCheckout: true };
  const account = T({ spend: 10000, purchases: 100, purchaseValue: 30000 });
  it("anúncio com gasto mínimo e 1 compra não vence o ranking de ROAS", () => {
    const ads = [
      { id: "tiny", name: "Pequeno", campaignId: "c", campaignName: "C", status: "ACTIVE", totals: T({ spend: 5, purchases: 1, purchaseValue: 300 }) },
      { id: "solid", name: "Sólido", campaignId: "c", campaignName: "C", status: "ACTIVE", totals: T({ spend: 2000, purchases: 30, purchaseValue: 9000 }) },
    ];
    const th = defaultThresholds(account, "purchases");
    expect(th).toEqual({ minSpend: 100, minResults: 3 });
    const r = rankAds(ads, { rankBy: "roas", kind: "purchases", thresholds: th, account, tracking, currency: "BRL" });
    expect(r.ranked.map((a) => a.id)).toEqual(["solid"]);
    expect(r.insufficient.map((a) => a.id)).toEqual(["tiny"]);
    expect(r.insufficient[0].insufficientReason).toContain("Dados insuficientes");
  });
});

describe("insights", () => {
  it("cada insight traz métrica, período, comparação e regra", () => {
    const tracking = { purchase: true, lead: false, messaging: false, landingPageView: true, addToCart: true, initiateCheckout: true };
    const ins = buildInsights({
      currency: "BRL",
      period: { from: "2026-09-01", to: "2026-09-30" },
      previous: { from: "2026-08-02", to: "2026-08-31" },
      current: T({ spend: 10000, purchases: 40, purchaseValue: 20000, linkClicks: 1000, landingPageViews: 400 }),
      prev: T({ spend: 10000, purchases: 60, purchaseValue: 40000 }),
      tracking,
      kind: "purchases",
      targets: { roas: 3 },
      campaigns: [{ id: "x", name: "Prospecção", group: "sales", totals: T({ spend: 2000, purchases: 0 }) }],
      topAds: [],
    });
    const ids = ins.map((i) => i.id);
    expect(ids).toContain("roas-below-target");
    expect(ids).toContain("spend-no-purchase-x");
    expect(ids).toContain("roas-deterioration");
    expect(ids).toContain("funnel-click-to-lpv");
    for (const i of ins) {
      expect(i.metric && i.period && i.comparison && i.rule).toBeTruthy();
    }
    expect(ins[0].severity).toBe("critical");
  });
});

describe("formatação pt-BR", () => {
  it("usa a moeda da conta e separadores brasileiros", () => {
    expect(fmtCurrency(1234.5, "BRL")).toBe("R$ 1.234,50");
    expect(fmtCurrency(1234.5, "USD")).toBe("US$ 1.234,50");
    expect(fmtRoas(3.456)).toBe("3,46×");
  });
});
