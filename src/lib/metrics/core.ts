/**
 * Núcleo de cálculo de métricas - funções puras, sem I/O, testadas em
 * tests/metrics.test.ts. Regras:
 *  - razões agregadas SEMPRE a partir dos totais (nunca média de razões);
 *  - denominador zero => "indisponível" explícito, nunca 0 nem Infinity;
 *  - "sem dados" (nenhuma linha) é diferente de "zero";
 *  - evento não rastreado na conta é diferente de zero.
 */

export type Totals = {
  spend: number;
  impressions: number;
  linkClicks: number;
  purchases: number;
  purchaseValue: number;
  leads: number;
  messagingConversations: number;
  landingPageViews: number;
  addToCart: number;
  initiateCheckout: number;
  /** Número de linhas (anúncio×dia) que compõem o total. 0 => sem dados. */
  rows: number;
};

export const ZERO_TOTALS: Totals = {
  spend: 0,
  impressions: 0,
  linkClicks: 0,
  purchases: 0,
  purchaseValue: 0,
  leads: 0,
  messagingConversations: 0,
  landingPageViews: 0,
  addToCart: 0,
  initiateCheckout: 0,
  rows: 0,
};

export type Unavailable = "no_data" | "zero_denominator" | "not_tracked";
export type MetricValue = { ok: true; value: number } | { ok: false; reason: Unavailable };

export const val = (value: number): MetricValue => ({ ok: true, value });
export const na = (reason: Unavailable): MetricValue => ({ ok: false, reason });

/** Soma apenas métricas aditivas. Alcance/frequência não entram aqui. */
export function sumTotals(rows: Partial<Totals>[]): Totals {
  const t = { ...ZERO_TOTALS };
  for (const r of rows) {
    t.spend += r.spend ?? 0;
    t.impressions += r.impressions ?? 0;
    t.linkClicks += r.linkClicks ?? 0;
    t.purchases += r.purchases ?? 0;
    t.purchaseValue += r.purchaseValue ?? 0;
    t.leads += r.leads ?? 0;
    t.messagingConversations += r.messagingConversations ?? 0;
    t.landingPageViews += r.landingPageViews ?? 0;
    t.addToCart += r.addToCart ?? 0;
    t.initiateCheckout += r.initiateCheckout ?? 0;
    t.rows += r.rows ?? 1;
  }
  return t;
}

export function ratio(numerator: number, denominator: number, scale = 1): MetricValue {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return na("no_data");
  if (denominator === 0) return na("zero_denominator");
  return val((numerator / denominator) * scale);
}

/** Quais eventos a conta efetivamente rastreia (tipo canônico encontrado). */
export type Tracking = {
  purchase: boolean;
  lead: boolean;
  messaging: boolean;
  landingPageView: boolean;
  addToCart: boolean;
  initiateCheckout: boolean;
};

export const ALL_TRACKED: Tracking = {
  purchase: true,
  lead: true,
  messaging: true,
  landingPageView: true,
  addToCart: true,
  initiateCheckout: true,
};

export type Kpis = {
  spend: MetricValue;
  impressions: MetricValue;
  linkClicks: MetricValue;
  purchases: MetricValue;
  purchaseValue: MetricValue;
  roas: MetricValue;
  costPerPurchase: MetricValue;
  averageOrderValue: MetricValue;
  ctr: MetricValue;
  cpc: MetricValue;
  cpm: MetricValue;
  landingPageViews: MetricValue;
  addToCart: MetricValue;
  initiateCheckout: MetricValue;
  leads: MetricValue;
  costPerLead: MetricValue;
  messagingConversations: MetricValue;
  costPerConversation: MetricValue;
};

export type KpiKey = keyof Kpis;

/**
 * Deriva KPIs a partir dos totais.
 *  ROAS = receita atribuída / gasto
 *  Custo por compra = gasto / compras
 *  Ticket médio = receita / compras
 *  CTR (link) = cliques no link / impressões × 100
 *  CPC (link) = gasto / cliques no link
 *  CPM = gasto / impressões × 1000
 */
export function deriveKpis(t: Totals, tracking: Tracking = ALL_TRACKED): Kpis {
  if (t.rows === 0) {
    const nd = na("no_data");
    return {
      spend: nd, impressions: nd, linkClicks: nd, purchases: nd, purchaseValue: nd, roas: nd,
      costPerPurchase: nd, averageOrderValue: nd, ctr: nd, cpc: nd, cpm: nd, landingPageViews: nd,
      addToCart: nd, initiateCheckout: nd, leads: nd, costPerLead: nd, messagingConversations: nd,
      costPerConversation: nd,
    };
  }
  const tracked = (flag: boolean, v: MetricValue): MetricValue => (flag ? v : na("not_tracked"));
  return {
    spend: val(t.spend),
    impressions: val(t.impressions),
    linkClicks: val(t.linkClicks),
    purchases: tracked(tracking.purchase, val(t.purchases)),
    purchaseValue: tracked(tracking.purchase, val(t.purchaseValue)),
    roas: tracked(tracking.purchase, ratio(t.purchaseValue, t.spend)),
    costPerPurchase: tracked(tracking.purchase, ratio(t.spend, t.purchases)),
    averageOrderValue: tracked(tracking.purchase, ratio(t.purchaseValue, t.purchases)),
    ctr: ratio(t.linkClicks, t.impressions, 100),
    cpc: ratio(t.spend, t.linkClicks),
    cpm: ratio(t.spend, t.impressions, 1000),
    landingPageViews: tracked(tracking.landingPageView, val(t.landingPageViews)),
    addToCart: tracked(tracking.addToCart, val(t.addToCart)),
    initiateCheckout: tracked(tracking.initiateCheckout, val(t.initiateCheckout)),
    leads: tracked(tracking.lead, val(t.leads)),
    costPerLead: tracked(tracking.lead, ratio(t.spend, t.leads)),
    messagingConversations: tracked(tracking.messaging, val(t.messagingConversations)),
    costPerConversation: tracked(tracking.messaging, ratio(t.spend, t.messagingConversations)),
  };
}

export type Delta = { ok: true; abs: number; pct: number | null } | { ok: false };

/** Variação vs período anterior. pct = null quando a base é zero. */
export function delta(current: MetricValue, previous: MetricValue): Delta {
  if (!current.ok || !previous.ok) return { ok: false };
  const abs = current.value - previous.value;
  const pct = previous.value === 0 ? null : (abs / Math.abs(previous.value)) * 100;
  return { ok: true, abs, pct };
}

/** Para cada KPI, se "subir" é bom (true), ruim (false) ou neutro (null). */
export const HIGHER_IS_BETTER: Record<KpiKey, boolean | null> = {
  spend: null,
  impressions: null,
  linkClicks: true,
  purchases: true,
  purchaseValue: true,
  roas: true,
  costPerPurchase: false,
  averageOrderValue: true,
  ctr: true,
  cpc: false,
  cpm: false,
  landingPageViews: true,
  addToCart: true,
  initiateCheckout: true,
  leads: true,
  costPerLead: false,
  messagingConversations: true,
  costPerConversation: false,
};

/* ------------------------------------------------------------------ */
/* Datas - sempre strings YYYY-MM-DD no fuso da conta                  */
/* ------------------------------------------------------------------ */

export function parseISODate(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(d: string, n: number): string {
  const dt = parseISODate(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return toISODate(dt);
}
export function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000) + 1;
}
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Período anterior de MESMA duração, imediatamente antes do atual. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const len = daysBetweenInclusive(from, to);
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(len - 1)), to: prevTo };
}

/** "Hoje" no fuso IANA da conta de anúncios. */
export function todayInTimezone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export type DatePreset = "7d" | "14d" | "30d" | "90d" | "mtd" | "last_month" | "today" | "custom";

/**
 * Intervalos padrão terminam ONTEM (dia completo) no fuso da conta.
 * "today" existe mas é sempre sinalizado como parcial.
 */
export function resolvePreset(preset: DatePreset, today: string, custom?: { from: string; to: string }) {
  const yesterday = addDays(today, -1);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(yesterday, -6), to: yesterday };
    case "14d":
      return { from: addDays(yesterday, -13), to: yesterday };
    case "30d":
      return { from: addDays(yesterday, -29), to: yesterday };
    case "90d":
      return { from: addDays(yesterday, -89), to: yesterday };
    case "mtd": {
      const first = today.slice(0, 8) + "01";
      return first === today ? { from: today, to: today } : { from: first, to: yesterday };
    }
    case "last_month": {
      const firstThis = parseISODate(today.slice(0, 8) + "01");
      const lastPrev = new Date(firstThis);
      lastPrev.setUTCDate(0);
      const firstPrev = new Date(Date.UTC(lastPrev.getUTCFullYear(), lastPrev.getUTCMonth(), 1));
      return { from: toISODate(firstPrev), to: toISODate(lastPrev) };
    }
    case "custom":
      if (!custom) throw new Error("custom exige from/to");
      return custom;
  }
}
