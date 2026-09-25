import { deriveKpis, delta, ratio, type Kpis, type MetricValue, type Totals, type Tracking, na, val } from "./core";
import type { ObjectiveGroup } from "./actions";
import { fmtCurrency, fmtNumber, fmtPct, fmtRoas, fmtSignedPct, fmtRange } from "@/lib/format";

/* ================================================================== */
/* Resultado principal por objetivo                                    */
/* ================================================================== */

export type ResultKind = "purchases" | "leads" | "messaging" | "linkClicks" | "impressions";

export function resultKindFor(group: ObjectiveGroup | "mixed"): ResultKind {
  switch (group) {
    case "sales":
      return "purchases";
    case "leads":
      return "leads";
    case "messaging":
      return "messaging";
    case "awareness":
      return "impressions";
    case "traffic":
    case "engagement":
      return "linkClicks";
    default:
      return "purchases";
  }
}

export const RESULT_LABEL: Record<ResultKind, { plural: string; singular: string; cost: string }> = {
  purchases: { plural: "compras", singular: "compra", cost: "Custo por compra" },
  leads: { plural: "leads", singular: "lead", cost: "Custo por lead" },
  messaging: { plural: "conversas", singular: "conversa", cost: "Custo por conversa" },
  linkClicks: { plural: "cliques no link", singular: "clique no link", cost: "CPC (link)" },
  impressions: { plural: "impressões", singular: "impressão", cost: "CPM" },
};

export function resultCount(t: Totals, kind: ResultKind): number {
  switch (kind) {
    case "purchases":
      return t.purchases;
    case "leads":
      return t.leads;
    case "messaging":
      return t.messagingConversations;
    case "linkClicks":
      return t.linkClicks;
    case "impressions":
      return t.impressions;
  }
}

export function costPerResult(t: Totals, kind: ResultKind): MetricValue {
  if (kind === "impressions") return ratio(t.spend, t.impressions, 1000);
  return ratio(t.spend, resultCount(t, kind));
}

/* ================================================================== */
/* Ranking de anúncios                                                  */
/* ================================================================== */

export type RankBy = "purchases" | "roas" | "purchaseValue" | "costPerPurchase" | "results" | "costPerResult";

export type AdPerf = {
  id: string;
  name: string;
  campaignName: string;
  campaignId: string;
  status: string | null;
  totals: Totals;
};

export type RankingThresholds = { minSpend: number; minResults: number };

export type RankedAd = AdPerf & {
  kpis: Kpis;
  results: number;
  cpr: MetricValue;
  eligible: boolean;
  tags: Array<"volume" | "efficiency">;
  explanation: string;
  insufficientReason?: string;
};

/**
 * Limiares padrão: gasto mínimo = custo por resultado da conta no período
 * (o gasto que, na média, gera 1 resultado) e ao menos 3 resultados.
 * Ambos configuráveis no workspace.
 */
export function defaultThresholds(account: Totals, kind: ResultKind, override?: { minSpend?: number | null; minResults?: number | null }): RankingThresholds {
  const accCpr = costPerResult(account, kind);
  const minSpend = override?.minSpend ?? (accCpr.ok ? Math.round(accCpr.value * 100) / 100 : 0);
  const minResults = override?.minResults ?? (kind === "impressions" || kind === "linkClicks" ? 100 : 3);
  return { minSpend, minResults };
}

export function rankAds(
  ads: AdPerf[],
  opts: {
    rankBy: RankBy;
    kind: ResultKind;
    thresholds: RankingThresholds;
    account: Totals;
    tracking: Tracking;
    currency: string;
  },
): { ranked: RankedAd[]; insufficient: RankedAd[] } {
  const { kind, thresholds, account, currency } = opts;
  const accK = deriveKpis(account, opts.tracking);
  const accCpr = costPerResult(account, kind);
  const label = RESULT_LABEL[kind];

  const enriched: RankedAd[] = ads.map((a) => {
    const kpis = deriveKpis(a.totals, opts.tracking);
    const results = resultCount(a.totals, kind);
    const cpr = costPerResult(a.totals, kind);
    const reasons: string[] = [];
    if (a.totals.spend < thresholds.minSpend) reasons.push(`gasto de ${fmtCurrency(a.totals.spend, currency)} abaixo do mínimo de ${fmtCurrency(thresholds.minSpend, currency)}`);
    if (results < thresholds.minResults) reasons.push(`${fmtNumber(results)} ${label.plural} (mínimo ${fmtNumber(thresholds.minResults)})`);
    return { ...a, kpis, results, cpr, eligible: reasons.length === 0, tags: [], explanation: "", insufficientReason: reasons.length ? `Dados insuficientes: ${reasons.join(" e ")}.` : undefined };
  });

  const eligible = enriched.filter((a) => a.eligible);
  // Alto volume: top 25% em resultados entre os elegíveis (mín. 1).
  const byResults = [...eligible].sort((a, b) => b.results - a.results);
  const volumeCut = Math.max(1, Math.ceil(byResults.length * 0.25));
  const volumeIds = new Set(byResults.slice(0, volumeCut).map((a) => a.id));

  for (const a of eligible) {
    if (volumeIds.has(a.id)) a.tags.push("volume");
    let efficient = false;
    if (kind === "purchases" && a.kpis.roas.ok && accK.roas.ok) efficient = a.kpis.roas.value >= accK.roas.value * 1.2;
    else if (a.cpr.ok && accCpr.ok) efficient = a.cpr.value <= accCpr.value * 0.8;
    if (efficient) a.tags.push("efficiency");

    const parts: string[] = [`${fmtNumber(a.results)} ${a.results === 1 ? label.singular : label.plural} com ${fmtCurrency(a.totals.spend, currency)} investidos`];
    if (kind === "purchases" && a.kpis.roas.ok && accK.roas.ok) parts.push(`ROAS ${fmtRoas(a.kpis.roas.value)} vs ${fmtRoas(accK.roas.value)} da conta`);
    else if (a.cpr.ok && accCpr.ok) parts.push(`${label.cost.toLowerCase()} ${fmtCurrency(a.cpr.value, currency)} vs ${fmtCurrency(accCpr.value, currency)} da conta`);
    a.explanation = parts.join(" · ") + ".";
  }

  const metricOf = (a: RankedAd): number | null => {
    switch (opts.rankBy) {
      case "purchases":
        return a.totals.purchases;
      case "purchaseValue":
        return a.totals.purchaseValue;
      case "roas":
        return a.kpis.roas.ok ? a.kpis.roas.value : null;
      case "costPerPurchase":
        return a.kpis.costPerPurchase.ok ? -a.kpis.costPerPurchase.value : null;
      case "results":
        return a.results;
      case "costPerResult":
        return a.cpr.ok ? -a.cpr.value : null;
    }
  };
  const ranked = eligible
    .filter((a) => metricOf(a) !== null)
    .sort((a, b) => (metricOf(b)! - metricOf(a)!) || b.totals.spend - a.totals.spend);
  const insufficient = enriched.filter((a) => !a.eligible && a.totals.spend > 0).sort((a, b) => b.totals.spend - a.totals.spend);
  return { ranked, insufficient };
}

/* ================================================================== */
/* Insights / alertas baseados em regras                               */
/* ================================================================== */

export type InsightSeverity = "critical" | "warning" | "positive" | "info";
export type Insight = {
  id: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  metric: string;
  period: string;
  comparison: string;
  rule: string;
  entity?: { type: "campaign" | "ad"; id: string; name: string };
};

export type InsightInput = {
  currency: string;
  period: { from: string; to: string };
  previous: { from: string; to: string };
  current: Totals;
  prev: Totals;
  tracking: Tracking;
  kind: ResultKind;
  targets: { roas?: number | null; cpa?: number | null };
  campaigns: Array<{ id: string; name: string; group: ObjectiveGroup; totals: Totals }>;
  topAds: RankedAd[];
};

const MIN_PURCHASES_FOR_TREND = 10;
const DETERIORATION_PCT = 20;

export function buildInsights(i: InsightInput): Insight[] {
  const out: Insight[] = [];
  const cur = deriveKpis(i.current, i.tracking);
  const prv = deriveKpis(i.prev, i.tracking);
  const period = fmtRange(i.period.from, i.period.to);
  const prevPeriod = fmtRange(i.previous.from, i.previous.to);
  const money = (v: number) => fmtCurrency(v, i.currency);

  if (i.targets.roas && cur.roas.ok && i.current.spend > 0 && cur.roas.value < i.targets.roas) {
    out.push({
      id: "roas-below-target",
      severity: "warning",
      title: "ROAS abaixo da meta",
      body: `O ROAS da conta foi ${fmtRoas(cur.roas.value)}, abaixo da meta de ${fmtRoas(i.targets.roas)}.`,
      metric: "ROAS",
      period,
      comparison: `Meta definida no workspace: ${fmtRoas(i.targets.roas)}`,
      rule: "ROAS do período < meta de ROAS",
    });
  }
  if (i.targets.cpa && cur.costPerPurchase.ok && cur.costPerPurchase.value > i.targets.cpa) {
    out.push({
      id: "cpa-above-target",
      severity: "warning",
      title: "Custo por compra acima da meta",
      body: `Cada compra custou ${money(cur.costPerPurchase.value)}, acima da meta de ${money(i.targets.cpa)}.`,
      metric: "Custo por compra",
      period,
      comparison: `Meta definida no workspace: ${money(i.targets.cpa)}`,
      rule: "Custo por compra do período > meta de CPA",
    });
  }

  // Gasto relevante sem compras (apenas campanhas de vendas, com pixel rastreando compras).
  if (i.tracking.purchase) {
    const threshold = Math.max(cur.costPerPurchase.ok ? cur.costPerPurchase.value * 2 : 0, i.current.spend * 0.05);
    for (const c of i.campaigns) {
      if (c.group !== "sales") continue;
      if (c.totals.spend >= threshold && threshold > 0 && c.totals.purchases === 0) {
        out.push({
          id: `spend-no-purchase-${c.id}`,
          severity: "critical",
          title: "Investimento sem compras atribuídas",
          body: `“${c.name}” investiu ${money(c.totals.spend)} sem nenhuma compra atribuída.`,
          metric: "Compras / Investimento",
          period,
          comparison: `Limiar: ${money(threshold)} (maior entre 2× o custo por compra da conta e 5% do investimento total)`,
          rule: "Campanha de vendas com gasto ≥ limiar e 0 compras atribuídas",
          entity: { type: "campaign", id: c.id, name: c.name },
        });
      }
    }
  }

  // Deterioração vs período anterior - só com volume mínimo nos dois períodos.
  if (i.tracking.purchase && i.current.purchases >= MIN_PURCHASES_FOR_TREND && i.prev.purchases >= MIN_PURCHASES_FOR_TREND) {
    const dR = delta(cur.roas, prv.roas);
    if (dR.ok && dR.pct !== null && dR.pct <= -DETERIORATION_PCT && cur.roas.ok && prv.roas.ok) {
      out.push({
        id: "roas-deterioration",
        severity: "warning",
        title: "ROAS caiu em relação ao período anterior",
        body: `ROAS passou de ${fmtRoas(prv.roas.value)} para ${fmtRoas(cur.roas.value)} (${fmtSignedPct(dR.pct)}). Isso indica mudança de desempenho, não a causa.`,
        metric: "ROAS",
        period,
        comparison: `Período anterior: ${prevPeriod}`,
        rule: `Queda ≥ ${DETERIORATION_PCT}% com ≥ ${MIN_PURCHASES_FOR_TREND} compras em cada período`,
      });
    }
    const dC = delta(cur.costPerPurchase, prv.costPerPurchase);
    if (dC.ok && dC.pct !== null && dC.pct >= DETERIORATION_PCT && cur.costPerPurchase.ok && prv.costPerPurchase.ok) {
      out.push({
        id: "cpa-deterioration",
        severity: "warning",
        title: "Custo por compra subiu",
        body: `Custo por compra passou de ${money(prv.costPerPurchase.value)} para ${money(cur.costPerPurchase.value)} (${fmtSignedPct(dC.pct)}).`,
        metric: "Custo por compra",
        period,
        comparison: `Período anterior: ${prevPeriod}`,
        rule: `Alta ≥ ${DETERIORATION_PCT}% com ≥ ${MIN_PURCHASES_FOR_TREND} compras em cada período`,
      });
    }
  }

  // Possível gargalo de funil: clique → visualização da página.
  if (i.tracking.landingPageView && i.current.linkClicks >= 200) {
    const r = ratio(i.current.landingPageViews, i.current.linkClicks, 100);
    if (r.ok && r.value < 60) {
      out.push({
        id: "funnel-click-to-lpv",
        severity: "info",
        title: "Possível perda entre clique e carregamento da página",
        body: `Apenas ${fmtPct(r.value)} dos cliques no link viraram visualização da página de destino. Pode indicar página lenta ou redirecionamentos: verifique antes de concluir.`,
        metric: "Visualizações da página ÷ Cliques no link",
        period,
        comparison: "Referência interna: 60% (eventos agregados, não coorte de usuários)",
        rule: "≥ 200 cliques no link e taxa < 60%",
      });
    }
  }
  if (i.tracking.initiateCheckout && i.tracking.purchase && i.current.initiateCheckout >= 30) {
    const r = ratio(i.current.purchases, i.current.initiateCheckout, 100);
    if (r.ok && r.value < 25) {
      out.push({
        id: "funnel-checkout-to-purchase",
        severity: "info",
        title: "Muitos checkouts sem compra atribuída",
        body: `${fmtNumber(i.current.initiateCheckout)} checkouts iniciados para ${fmtNumber(i.current.purchases)} compras (${fmtPct(r.value)}). Vale revisar frete, meios de pagamento e o evento de compra.`,
        metric: "Compras ÷ Checkouts iniciados",
        period,
        comparison: "Referência interna: 25% (eventos agregados, não coorte de usuários)",
        rule: "≥ 30 checkouts iniciados e taxa < 25%",
      });
    }
  }

  // Anúncio de alto desempenho com evidência suficiente.
  const star = i.topAds.find((a) => a.tags.includes("efficiency") && a.tags.includes("volume"));
  if (star) {
    out.push({
      id: `top-ad-${star.id}`,
      severity: "positive",
      title: "Anúncio com desempenho acima da conta",
      body: `“${star.name}”: ${star.explanation}`,
      metric: i.kind === "purchases" ? "ROAS" : RESULT_LABEL[i.kind].cost,
      period,
      comparison: "Média da conta no mesmo período",
      rule: "Passa os limiares mínimos, está no top 25% em volume e é ≥ 20% mais eficiente que a conta",
      entity: { type: "ad", id: star.id, name: star.name },
    });
  }

  const order: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2, positive: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/* ================================================================== */
/* Funis agregados de eventos                                          */
/* ================================================================== */

export type FunnelMetric =
  | "impressions"
  | "link_clicks"
  | "landing_page_views"
  | "add_to_cart"
  | "initiate_checkout"
  | "purchases"
  | "leads"
  | "messaging_conversations";

export const FUNNEL_METRIC_INFO: Record<FunnelMetric, { label: string; definition: string; attributed: boolean; trackingKey?: keyof Tracking }> = {
  impressions: { label: "Impressões", definition: "impressions: vezes que os anúncios foram exibidos", attributed: false },
  link_clicks: { label: "Cliques no link", definition: "inline_link_clicks: cliques que levam ao destino", attributed: false },
  landing_page_views: { label: "Visualizações da página", definition: "landing_page_view: carregamento da página após o clique (pixel)", attributed: true, trackingKey: "landingPageView" },
  add_to_cart: { label: "Adições ao carrinho", definition: "add_to_cart canônico da conta (pixel/CAPI), atribuído", attributed: true, trackingKey: "addToCart" },
  initiate_checkout: { label: "Checkouts iniciados", definition: "initiate_checkout canônico (pixel/CAPI), atribuído", attributed: true, trackingKey: "initiateCheckout" },
  purchases: { label: "Compras", definition: "purchase canônico (ex.: omni_purchase), atribuído", attributed: true, trackingKey: "purchase" },
  leads: { label: "Leads", definition: "lead canônico (formulário instantâneo ou pixel), atribuído", attributed: true, trackingKey: "lead" },
  messaging_conversations: { label: "Conversas iniciadas", definition: "messaging_conversation_started_7d", attributed: true, trackingKey: "messaging" },
};

export function funnelMetricValue(t: Totals, m: FunnelMetric): number {
  switch (m) {
    case "impressions":
      return t.impressions;
    case "link_clicks":
      return t.linkClicks;
    case "landing_page_views":
      return t.landingPageViews;
    case "add_to_cart":
      return t.addToCart;
    case "initiate_checkout":
      return t.initiateCheckout;
    case "purchases":
      return t.purchases;
    case "leads":
      return t.leads;
    case "messaging_conversations":
      return t.messagingConversations;
  }
}

export type FunnelStageResult = {
  key: string;
  label: string;
  metric: FunnelMetric;
  definition: string;
  value: MetricValue;
  previous: MetricValue;
  change: ReturnType<typeof delta>;
  /** Taxa em relação à etapa anterior disponível; null na 1ª etapa ou se indisponível. */
  rateFromPrev: MetricValue | null;
  /** Taxa > 100%: a etapa tem mais eventos que a anterior - NÃO é limitada a 100%. */
  exceedsPrev: boolean;
  dropOff: MetricValue | null;
  costPerEvent: MetricValue;
  isBottleneck: boolean;
};

export type FunnelResult = {
  stages: FunnelStageResult[];
  warnings: string[];
};

export function computeFunnel(
  stages: Array<{ key: string; label: string; metric: FunnelMetric }>,
  current: Totals,
  previous: Totals,
  tracking: Tracking,
): FunnelResult {
  const warnings: string[] = [];
  const out: FunnelStageResult[] = [];
  let prevStage: { value: number } | null = null;

  for (const s of stages) {
    const info = FUNNEL_METRIC_INFO[s.metric];
    const trackedFlag = info.trackingKey ? tracking[info.trackingKey] : true;
    const noData = current.rows === 0;
    const value: MetricValue = noData ? na("no_data") : !trackedFlag ? na("not_tracked") : val(funnelMetricValue(current, s.metric));
    const previousV: MetricValue = previous.rows === 0 ? na("no_data") : !trackedFlag ? na("not_tracked") : val(funnelMetricValue(previous, s.metric));
    let rateFromPrev: MetricValue | null = null;
    let dropOff: MetricValue | null = null;
    let exceeds = false;
    if (prevStage && value.ok) {
      rateFromPrev = ratio(value.value, prevStage.value, 100);
      if (rateFromPrev.ok) {
        exceeds = rateFromPrev.value > 100;
        dropOff = exceeds ? null : val(100 - rateFromPrev.value);
      }
    }
    out.push({
      key: s.key,
      label: s.label,
      metric: s.metric,
      definition: info.definition,
      value,
      previous: previousV,
      change: delta(value, previousV),
      rateFromPrev,
      exceedsPrev: exceeds,
      dropOff,
      costPerEvent: value.ok ? ratio(current.spend, value.value) : value,
      isBottleneck: false,
    });
    if (value.ok) prevStage = { value: value.value };
    // Etapa indisponível: a próxima taxa é calculada contra a última etapa disponível e sinalizada.
    if (!value.ok && value.reason === "not_tracked") warnings.push(`A etapa “${s.label}” não é rastreada nesta conta e foi deixada de fora do cálculo das taxas.`);
  }

  const exceeding = out.filter((s) => s.exceedsPrev);
  if (exceeding.length)
    warnings.push(
      `Em ${exceeding.map((s) => `“${s.label}”`).join(", ")} há mais eventos do que na etapa anterior. Isso acontece com eventos agregados (ex.: uma pessoa gera vários eventos, ou eventos atribuídos por visualização sem clique). A taxa não foi limitada a 100%.`,
    );
  const hasUnattributed = stages.some((s) => !FUNNEL_METRIC_INFO[s.metric].attributed);
  const hasAttributed = stages.some((s) => FUNNEL_METRIC_INFO[s.metric].attributed);
  if (hasUnattributed && hasAttributed)
    warnings.push(
      "Impressões e cliques são contagens de entrega; as demais etapas são conversões atribuídas pela Meta (janela de atribuição do conjunto). As etapas não medem as mesmas pessoas.",
    );

  // Gargalo: maior perda percentual entre etapas comparáveis (apenas se houver dados).
  // Impressões → clique é sempre a maior queda (é o CTR); por isso só etapas pós-clique concorrem.
  const candidates = out.filter((s, i) => s.dropOff?.ok && s.rateFromPrev?.ok && out.slice(0, i).reverse().find((x) => x.value.ok)?.metric !== "impressions");
  if (candidates.length) {
    const worst = candidates.reduce((a, b) => ((a.dropOff as { value: number }).value >= (b.dropOff as { value: number }).value ? a : b));
    worst.isBottleneck = true;
  }
  return { stages: out, warnings };
}

export const FUNNEL_TEMPLATES: Record<string, { name: string; stages: Array<{ key: string; label: string; metric: FunnelMetric }> }> = {
  ecommerce: {
    name: "E-commerce",
    stages: [
      { key: "imp", label: "Impressões", metric: "impressions" },
      { key: "clk", label: "Cliques no link", metric: "link_clicks" },
      { key: "lpv", label: "Visualizações da página", metric: "landing_page_views" },
      { key: "atc", label: "Adições ao carrinho", metric: "add_to_cart" },
      { key: "ic", label: "Checkouts iniciados", metric: "initiate_checkout" },
      { key: "pur", label: "Compras", metric: "purchases" },
    ],
  },
  leads: {
    name: "Captação de leads",
    stages: [
      { key: "imp", label: "Impressões", metric: "impressions" },
      { key: "clk", label: "Cliques no link", metric: "link_clicks" },
      { key: "lpv", label: "Visualizações da página", metric: "landing_page_views" },
      { key: "lead", label: "Leads", metric: "leads" },
    ],
  },
  messaging: {
    name: "Mensagens",
    stages: [
      { key: "imp", label: "Impressões", metric: "impressions" },
      { key: "clk", label: "Cliques no link", metric: "link_clicks" },
      { key: "msg", label: "Conversas iniciadas", metric: "messaging_conversations" },
    ],
  },
};
