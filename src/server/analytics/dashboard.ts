import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { deriveKpis, sumTotals, eachDay, todayInTimezone, ratio, ZERO_TOTALS, type Totals, type Kpis, type MetricValue } from "@/lib/metrics/core";
import { trackingFromMap, OBJECTIVE_LABEL, type ObjectiveGroup } from "@/lib/metrics/actions";
import {
  rankAds,
  buildInsights,
  computeFunnel,
  defaultThresholds,
  resultKindFor,
  resultCount,
  costPerResult,
  FUNNEL_TEMPLATES,
  type RankBy,
  type ResultKind,
  type FunnelMetric,
  type Insight,
} from "@/lib/metrics/analysis";
import { buildRecommendations } from "@/lib/metrics/recommendations";
import type { ViewFilters } from "@/lib/filters";
import type { WorkspaceContext } from "@/server/tenancy/access";
import * as q from "./queries";
import { cached } from "./cache";

type Account = typeof schema.adAccounts.$inferSelect;

export type Freshness = {
  syncStatus: Account["syncStatus"];
  syncProgress: number | null;
  lastSuccessfulSyncAt: string | null;
  lastSyncStartedAt: string | null;
  dataThrough: string | null;
  dataFrom: string | null;
  initialDone: boolean;
  stale: boolean;
  staleReason: string | null;
  connectionStatus: string | null;
  connectionMessage: string | null;
  lastErrorMessage: string | null;
  generatedAt: string;
  intervalMinutes: number;
  todayInAccountTz: string;
};

export type AccountInfo = {
  id: string;
  name: string;
  externalId: string;
  currency: string;
  timezone: string;
  isDemo: boolean;
  businessName: string | null;
};

export async function getFreshness(ctx: WorkspaceContext, acc: Account): Promise<Freshness> {
  const db = getDb();
  const [conn] = acc.connectionId
    ? await db
        .select({ status: schema.providerConnections.status, msg: schema.providerConnections.lastErrorMessage })
        .from(schema.providerConnections)
        .where(and(eq(schema.providerConnections.id, acc.connectionId), eq(schema.providerConnections.workspaceId, ctx.workspaceId)))
    : [];
  const [job] = await db.select().from(schema.syncJobs).where(eq(schema.syncJobs.adAccountId, acc.id));
  const interval = job?.intervalMinutes ?? Number(process.env.SYNC_INTERVAL_MINUTES ?? 15);
  const now = Date.now();
  let stale = false;
  let staleReason: string | null = null;
  if (!ctx.isDemo) {
    if (!conn || conn.status !== "active") {
      stale = true;
      staleReason = conn?.status === "disconnected" ? "A conexão com a Meta foi desconectada: os dados não estão sendo atualizados." : "A autorização da Meta precisa ser renovada: os dados não estão sendo atualizados.";
    } else if (acc.syncStatus === "permission_denied") {
      stale = true;
      staleReason = "A Meta negou acesso a esta conta. Os dados exibidos podem estar desatualizados.";
    } else if (acc.lastSuccessfulSyncAt && now - acc.lastSuccessfulSyncAt.getTime() > Math.max(3 * interval, 60) * 60_000) {
      stale = true;
      staleReason = "A última sincronização bem-sucedida é mais antiga que o esperado.";
    }
  }
  return {
    syncStatus: acc.syncStatus,
    syncProgress: acc.syncProgress,
    lastSuccessfulSyncAt: acc.lastSuccessfulSyncAt?.toISOString() ?? null,
    lastSyncStartedAt: acc.lastSyncStartedAt?.toISOString() ?? null,
    dataThrough: acc.dataThrough,
    dataFrom: acc.dataFrom,
    initialDone: Boolean(acc.initialSyncCompletedAt),
    stale,
    staleReason,
    connectionStatus: ctx.isDemo ? "demo" : (conn?.status ?? null),
    connectionMessage: conn?.msg ?? null,
    lastErrorMessage: acc.lastErrorMessage,
    generatedAt: new Date().toISOString(),
    intervalMinutes: interval,
    todayInAccountTz: todayInTimezone(acc.timezoneName),
  };
}

export function accountInfo(acc: Account, isDemo: boolean): AccountInfo {
  return { id: acc.id, name: acc.name, externalId: acc.externalId, currency: acc.currency, timezone: acc.timezoneName, isDemo, businessName: acc.businessName };
}

/** Resolve o filtro de campanha/objetivo em uma lista de campaign ids (ou null = todas). */
async function scopeCampaigns(scope: q.Scope, f: ViewFilters, meta?: q.CampaignMeta[]) {
  const campaigns = meta ?? (await q.listCampaignMeta(scope));
  let ids: string[] | null = null;
  if (f.objective) ids = campaigns.filter((c) => c.group === f.objective).map((c) => c.id);
  if (f.campaign) {
    const ok = campaigns.some((c) => c.id === f.campaign);
    ids = ok ? (ids ? ids.filter((x) => x === f.campaign) : [f.campaign]) : [];
  }
  return { campaigns, ids };
}

function dominantGroup(campaigns: q.CampaignMeta[], byCampaign: Map<string, Totals>, f: ViewFilters): ObjectiveGroup | "mixed" {
  if (f.objective) return f.objective;
  const spendByGroup = new Map<ObjectiveGroup, number>();
  for (const c of campaigns) {
    const s = byCampaign.get(c.id)?.spend ?? 0;
    spendByGroup.set(c.group, (spendByGroup.get(c.group) ?? 0) + s);
  }
  const sorted = [...spendByGroup.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? "mixed";
}

export type SeriesPoint = {
  date: string;
  hasData: boolean;
  partial: boolean;
  spend: number | null;
  revenue: number | null;
  purchases: number | null;
  results: number | null;
  roas: number | null;
  cpr: number | null;
  prevSpend: number | null;
  prevRevenue: number | null;
  prevRoas: number | null;
  prevPurchases: number | null;
};

function buildSeries(
  f: ViewFilters,
  daily: Array<Totals & { date: string }>,
  prevDaily: Array<Totals & { date: string }>,
  acc: Account,
  kind: ResultKind,
  today: string,
): SeriesPoint[] {
  const cur = new Map(daily.map((d) => [d.date, d]));
  const prev = new Map(prevDaily.map((d) => [d.date, d]));
  const days = eachDay(f.from, f.to);
  const prevDays = eachDay(f.prevFrom, f.prevTo);
  // Dia sem linha: é zero genuíno se estiver dentro da cobertura sincronizada; senão, sem dados.
  const covered = (d: string) => Boolean(acc.dataFrom && acc.dataThrough && d >= acc.dataFrom && d <= acc.dataThrough);
  return days.map((d, i) => {
    const row = cur.get(d) ?? (covered(d) ? { ...ZERO_TOTALS, date: d } : null);
    const pd = prevDays[i];
    const prow = pd ? (prev.get(pd) ?? (covered(pd) ? { ...ZERO_TOTALS, date: pd } : null)) : null;
    const roas = row ? ratio(row.purchaseValue, row.spend) : null;
    const proas = prow ? ratio(prow.purchaseValue, prow.spend) : null;
    const cpr = row ? costPerResult(row, kind) : null;
    return {
      date: d,
      hasData: Boolean(row),
      partial: d >= today,
      spend: row ? row.spend : null,
      revenue: row ? row.purchaseValue : null,
      purchases: row ? row.purchases : null,
      results: row ? resultCount(row, kind) : null,
      roas: roas && roas.ok ? roas.value : null,
      cpr: cpr && cpr.ok ? cpr.value : null,
      prevSpend: prow ? prow.spend : null,
      prevRevenue: prow ? prow.purchaseValue : null,
      prevRoas: proas && proas.ok ? proas.value : null,
      prevPurchases: prow ? prow.purchases : null,
    };
  });
}

export type CampaignRow = {
  id: string;
  name: string;
  group: ObjectiveGroup;
  groupLabel: string;
  status: string | null;
  totals: Totals;
  kpis: Kpis;
  results: number;
  cpr: MetricValue;
  spendShare: number;
  revenueShare: number;
};

export async function getOverview(ctx: WorkspaceContext, acc: Account, f: ViewFilters, rankBy: RankBy = "roas") {
  const scope = { workspaceId: ctx.workspaceId, adAccountId: acc.id };
  const version = acc.lastSuccessfulSyncAt?.toISOString() ?? "none";
  const key = JSON.stringify({ v: "overview", f, rankBy, s: ctx.settings });
  const data = await cached({ workspaceId: ctx.workspaceId, adAccountId: acc.id, version, key }, 60_000, async () => {
    const { campaigns, ids } = await scopeCampaigns(scope, f);
    const range = { from: f.from, to: f.to, campaignIds: ids };
    const prevRange = { from: f.prevFrom, to: f.prevTo, campaignIds: ids };
    const tracking = trackingFromMap(acc.actionTypeMap ?? {});
    const [current, previous, daily, prevDaily, byCampaign, byAd, prevByCampaign, prevByAd, adsMeta, reachCur, reachPrev, placements, savedFunnels] = await Promise.all([
      q.getTotals(scope, range),
      q.getTotals(scope, prevRange),
      q.getDaily(scope, range),
      q.getDaily(scope, prevRange),
      q.getByCampaign(scope, range),
      q.getByAd(scope, range),
      q.getByCampaign(scope, prevRange),
      q.getByAd(scope, prevRange),
      q.listAdMeta(scope),
      q.getReach(scope, f.from, f.to),
      q.getReach(scope, f.prevFrom, f.prevTo),
      q.getPlacements(scope, range),
      getDb().select().from(schema.funnels).where(and(eq(schema.funnels.workspaceId, ctx.workspaceId), eq(schema.funnels.adAccountId, acc.id))).orderBy(desc(schema.funnels.createdAt)).limit(1),
    ]);
    const group = dominantGroup(campaigns, byCampaign, f);
    const kind: ResultKind = group === "sales" && !tracking.purchase ? "linkClicks" : resultKindFor(group);
    const today = todayInTimezone(acc.timezoneName);

    const campaignRows: CampaignRow[] = campaigns
      .filter((c) => byCampaign.has(c.id))
      .map((c) => {
        const t = byCampaign.get(c.id)!;
        const ck = resultKindFor(c.group);
        return {
          id: c.id,
          name: c.name,
          group: c.group,
          groupLabel: OBJECTIVE_LABEL[c.group],
          status: c.effectiveStatus ?? c.status,
          totals: t,
          kpis: deriveKpis(t, tracking),
          results: resultCount(t, ck),
          cpr: costPerResult(t, ck),
          spendShare: current.spend ? t.spend / current.spend : 0,
          revenueShare: current.purchaseValue ? t.purchaseValue / current.purchaseValue : 0,
        };
      })
      .sort((a, b) => b.totals.spend - a.totals.spend);

    const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
    const groupOf = new Map(campaigns.map((c) => [c.id, c.group]));
    // O ranking compara anúncios pelo mesmo tipo de resultado: só entram anúncios de campanhas do objetivo principal.
    const adPerf = adsMeta
      .filter((a) => byAd.has(a.id) && (group === "mixed" || groupOf.get(a.campaignId) === group))
      .map((a) => ({ id: a.id, name: a.name, campaignId: a.campaignId, campaignName: campaignName.get(a.campaignId) ?? "n/d", status: a.effectiveStatus ?? a.status, totals: byAd.get(a.id)!, creative: a.creative, previewLink: a.previewShareableLink }));
    const thresholds = defaultThresholds(current, kind, { minSpend: ctx.settings.rankingMinSpend, minResults: ctx.settings.rankingMinResults });
    const effectiveRankBy: RankBy = kind === "purchases" ? rankBy : rankBy === "costPerPurchase" || rankBy === "costPerResult" ? "costPerResult" : "results";
    const ranking = rankAds(adPerf, { rankBy: effectiveRankBy, kind, thresholds, account: current, tracking, currency: acc.currency });
    const creativeById = new Map(adPerf.map((a) => [a.id, { creative: a.creative, previewLink: a.previewLink }]));

    // Funil salvo (mapeado por campanhas) usa o próprio mapeamento, restrito ao filtro atual.
    // Funil mapeado por conjuntos, ou sem funil salvo: modelo padrão sobre o recorte atual.
    const saved = savedFunnels[0] && savedFunnels[0].adSetIds.length === 0 ? savedFunnels[0] : null;
    let funnelCur = current;
    let funnelPrev = previous;
    let funnelDef: { name: string; stages: Array<{ key: string; label: string; metric: FunnelMetric }>; custom: boolean };
    if (saved) {
      const mapped = saved.campaignIds.length ? saved.campaignIds : null;
      const effective = mapped && ids ? mapped.filter((x) => ids.includes(x)) : (mapped ?? ids);
      [funnelCur, funnelPrev] = await Promise.all([
        q.getTotals(scope, { from: f.from, to: f.to, campaignIds: effective }),
        q.getTotals(scope, { from: f.prevFrom, to: f.prevTo, campaignIds: effective }),
      ]);
      funnelDef = { name: saved.name, stages: saved.stages as Array<{ key: string; label: string; metric: FunnelMetric }>, custom: true };
    } else {
      const t = kind === "leads" ? FUNNEL_TEMPLATES.leads : kind === "messaging" ? FUNNEL_TEMPLATES.messaging : FUNNEL_TEMPLATES.ecommerce;
      funnelDef = { name: `${t.name} (recorte atual)`, stages: t.stages, custom: false };
    }
    const funnel = computeFunnel(funnelDef.stages, funnelCur, funnelPrev, tracking);

    const insights: Insight[] = buildInsights({
      currency: acc.currency,
      period: { from: f.from, to: f.to },
      previous: { from: f.prevFrom, to: f.prevTo },
      current,
      prev: previous,
      tracking,
      kind,
      targets: { roas: ctx.settings.roasTarget, cpa: ctx.settings.cpaTarget },
      campaigns: campaignRows.map((c) => ({ id: c.id, name: c.name, group: c.group, totals: c.totals })),
      topAds: ranking.ranked,
    });

    // Recomendações (regras do Growth OS) sobre o MESMO recorte de filtros.
    const reconciliationDays = Number(process.env.SYNC_RECONCILIATION_DAYS ?? 7);
    const winners = ranking.ranked
      .filter((a) => a.tags.includes("volume") && a.tags.includes("efficiency"))
      .map((a) => ({ id: a.id, name: a.name, campaignName: a.campaignName, explanation: a.explanation, spend: a.totals.spend }));
    const recommendations = buildRecommendations({
      currency: acc.currency,
      period: { from: f.from, to: f.to },
      previous: { from: f.prevFrom, to: f.prevTo },
      today,
      reconciliationDays,
      kind,
      tracking,
      targets: { roas: ctx.settings.roasTarget, cpa: ctx.settings.cpaTarget },
      account: { current, previous },
      campaigns: campaigns
        .filter((c) => byCampaign.has(c.id))
        .map((c) => ({ id: c.id, name: c.name, status: c.effectiveStatus ?? c.status, group: c.group, current: byCampaign.get(c.id)!, previous: prevByCampaign.get(c.id) ?? { ...ZERO_TOTALS } })),
      ads: adsMeta
        .filter((a) => byAd.has(a.id) && (!ids || ids.includes(a.campaignId)))
        .map((a) => ({ id: a.id, name: a.name, status: a.effectiveStatus ?? a.status, campaignId: a.campaignId, campaignName: campaignName.get(a.campaignId) ?? "n/d", group: groupOf.get(a.campaignId) ?? "other", current: byAd.get(a.id)!, previous: prevByAd.get(a.id) ?? { ...ZERO_TOTALS } })),
      winners,
    });

    const placementRows = placements
      .map((p) => ({ ...p, spend: Number(p.spend), impressions: Number(p.impressions), linkClicks: Number(p.linkClicks), purchases: Number(p.purchases), purchaseValue: Number(p.purchaseValue) }))
      .sort((a, b) => b.spend - a.spend);

    return {
      kind,
      group,
      tracking,
      current,
      previous,
      kpis: deriveKpis(current, tracking),
      prevKpis: deriveKpis(previous, tracking),
      reach: { current: reachCur.account, previous: reachPrev.account },
      series: buildSeries(f, daily, prevDaily, acc, kind, today),
      campaigns: campaignRows,
      ranking: {
        thresholds,
        rankBy: effectiveRankBy,
        top: ranking.ranked.slice(0, 8).map((a) => ({ ...a, ...creativeById.get(a.id) })),
        insufficientCount: ranking.insufficient.length,
      },
      funnel: { name: funnelDef.name, custom: funnelDef.custom, ...funnel },
      insights,
      recommendations: { ...recommendations, generatedAt: new Date().toISOString() },
      placements: placementRows,
      hasAnyData: current.rows > 0 || previous.rows > 0,
    };
  });
  return data;
}

export type Overview = Awaited<ReturnType<typeof getOverview>>;

/* ------------------------------------------------------------------ */
/* Explorador de campanhas (campanha → conjunto → anúncio)             */
/* ------------------------------------------------------------------ */

export type ExplorerRow = {
  id: string;
  level: "campaign" | "adset" | "ad";
  name: string;
  status: string | null;
  group?: ObjectiveGroup;
  groupLabel?: string;
  parentName?: string;
  totals: Totals;
  prevTotals: Totals;
  kpis: Kpis;
  prevKpis: Kpis;
  results: number;
  cpr: MetricValue;
  resultKind: ResultKind;
  thumbnailUrl?: string | null;
};

export async function getExplorer(ctx: WorkspaceContext, acc: Account, f: ViewFilters, level: { campaignId?: string; adSetId?: string }) {
  const scope = { workspaceId: ctx.workspaceId, adAccountId: acc.id };
  const version = acc.lastSuccessfulSyncAt?.toISOString() ?? "none";
  return cached({ workspaceId: ctx.workspaceId, adAccountId: acc.id, version, key: JSON.stringify({ v: "explorer", f, level }) }, 60_000, async () => {
    const { campaigns, ids } = await scopeCampaigns(scope, f);
    const tracking = trackingFromMap(acc.actionTypeMap ?? {});
    const range = { from: f.from, to: f.to, campaignIds: ids };
    const prevRange = { from: f.prevFrom, to: f.prevTo, campaignIds: ids };
    const cmap = new Map(campaigns.map((c) => [c.id, c]));

    // Validação: IDs de campanha/conjunto precisam pertencer à conta (senão, nada é exibido).
    const campaign = level.campaignId ? cmap.get(level.campaignId) : undefined;
    if (level.campaignId && !campaign) return { rows: [], breadcrumb: [], tracking, notFound: true as const };

    let rows: ExplorerRow[] = [];
    const breadcrumb: Array<{ level: "campaign" | "adset"; id: string; name: string }> = [];
    if (!level.campaignId) {
      const [cur, prev] = await Promise.all([q.getByCampaign(scope, range), q.getByCampaign(scope, prevRange)]);
      rows = campaigns
        .filter((c) => cur.has(c.id) || prev.has(c.id))
        .map((c) => {
          const kind = resultKindFor(c.group);
          const t = cur.get(c.id) ?? { ...ZERO_TOTALS };
          const pt = prev.get(c.id) ?? { ...ZERO_TOTALS };
          return { id: c.id, level: "campaign" as const, name: c.name, status: c.effectiveStatus ?? c.status, group: c.group, groupLabel: OBJECTIVE_LABEL[c.group], totals: t, prevTotals: pt, kpis: deriveKpis(t, tracking), prevKpis: deriveKpis(pt, tracking), results: resultCount(t, kind), cpr: costPerResult(t, kind), resultKind: kind };
        });
    } else if (!level.adSetId) {
      breadcrumb.push({ level: "campaign", id: campaign!.id, name: campaign!.name });
      const kind = resultKindFor(campaign!.group);
      const [sets, cur, prev] = await Promise.all([q.listAdSetMeta(scope, campaign!.id), q.getByAdSet(scope, range, campaign!.id), q.getByAdSet(scope, prevRange, campaign!.id)]);
      rows = sets
        .filter((s) => cur.has(s.id) || prev.has(s.id))
        .map((s) => {
          const t = cur.get(s.id) ?? { ...ZERO_TOTALS };
          const pt = prev.get(s.id) ?? { ...ZERO_TOTALS };
          return { id: s.id, level: "adset" as const, name: s.name, status: s.effectiveStatus ?? s.status, parentName: campaign!.name, group: campaign!.group, totals: t, prevTotals: pt, kpis: deriveKpis(t, tracking), prevKpis: deriveKpis(pt, tracking), results: resultCount(t, kind), cpr: costPerResult(t, kind), resultKind: kind };
        });
    } else {
      const sets = await q.listAdSetMeta(scope, campaign!.id);
      const set = sets.find((s) => s.id === level.adSetId);
      if (!set) return { rows: [], breadcrumb: [], tracking, notFound: true as const };
      breadcrumb.push({ level: "campaign", id: campaign!.id, name: campaign!.name }, { level: "adset", id: set.id, name: set.name });
      const kind = resultKindFor(campaign!.group);
      const [ads, cur, prev] = await Promise.all([q.listAdMeta(scope, { adSetId: set.id }), q.getByAd(scope, range, { adSetId: set.id }), q.getByAd(scope, prevRange, { adSetId: set.id })]);
      rows = ads
        .filter((a) => cur.has(a.id) || prev.has(a.id))
        .map((a) => {
          const t = cur.get(a.id) ?? { ...ZERO_TOTALS };
          const pt = prev.get(a.id) ?? { ...ZERO_TOTALS };
          return { id: a.id, level: "ad" as const, name: a.name, status: a.effectiveStatus ?? a.status, parentName: set.name, group: campaign!.group, totals: t, prevTotals: pt, kpis: deriveKpis(t, tracking), prevKpis: deriveKpis(pt, tracking), results: resultCount(t, kind), cpr: costPerResult(t, kind), resultKind: kind, thumbnailUrl: a.creative?.thumbnailUrl ?? null };
        });
    }
    rows.sort((a, b) => b.totals.spend - a.totals.spend);
    const total = sumTotals(rows.map((r) => r.totals));
    return { rows, breadcrumb, tracking, total: { ...total, rows: rows.reduce((s, r) => s + r.totals.rows, 0) }, notFound: false as const };
  });
}

/* ------------------------------------------------------------------ */
/* Criativos                                                           */
/* ------------------------------------------------------------------ */

export async function getCreatives(ctx: WorkspaceContext, acc: Account, f: ViewFilters, rankBy: RankBy) {
  const scope = { workspaceId: ctx.workspaceId, adAccountId: acc.id };
  const version = acc.lastSuccessfulSyncAt?.toISOString() ?? "none";
  return cached({ workspaceId: ctx.workspaceId, adAccountId: acc.id, version, key: JSON.stringify({ v: "creatives", f, rankBy, s: ctx.settings }) }, 60_000, async () => {
    const { campaigns, ids } = await scopeCampaigns(scope, f);
    const tracking = trackingFromMap(acc.actionTypeMap ?? {});
    const range = { from: f.from, to: f.to, campaignIds: ids };
    const [current, byAd, byCampaign, adsMeta] = await Promise.all([q.getTotals(scope, range), q.getByAd(scope, range), q.getByCampaign(scope, range), q.listAdMeta(scope)]);
    const group = dominantGroup(campaigns, byCampaign, f);
    const kind: ResultKind = group === "sales" && !tracking.purchase ? "linkClicks" : resultKindFor(group);
    const cname = new Map(campaigns.map((c) => [c.id, c.name]));
    const groupOf = new Map(campaigns.map((c) => [c.id, c.group]));
    const perf = adsMeta
      .filter((a) => byAd.has(a.id) && (group === "mixed" || groupOf.get(a.campaignId) === group))
      .map((a) => ({ id: a.id, name: a.name, campaignId: a.campaignId, campaignName: cname.get(a.campaignId) ?? "n/d", status: a.effectiveStatus ?? a.status, totals: byAd.get(a.id)! }));
    const thresholds = defaultThresholds(current, kind, { minSpend: ctx.settings.rankingMinSpend, minResults: ctx.settings.rankingMinResults });
    const effectiveRankBy: RankBy = kind === "purchases" ? rankBy : rankBy === "costPerPurchase" || rankBy === "costPerResult" ? "costPerResult" : "results";
    const r = rankAds(perf, { rankBy: effectiveRankBy, kind, thresholds, account: current, tracking, currency: acc.currency });
    const meta = new Map(adsMeta.map((a) => [a.id, a]));
    const decorate = <T extends { id: string }>(x: T) => ({ ...x, creative: meta.get(x.id)?.creative ?? {}, previewLink: meta.get(x.id)?.previewShareableLink ?? null });
    return {
      kind,
      group,
      tracking,
      thresholds,
      rankBy: effectiveRankBy,
      account: deriveKpis(current, tracking),
      ranked: r.ranked.map(decorate),
      insufficient: r.insufficient.map(decorate),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Funis                                                               */
/* ------------------------------------------------------------------ */

export async function getFunnels(ctx: WorkspaceContext, acc: Account, f: ViewFilters) {
  const scope = { workspaceId: ctx.workspaceId, adAccountId: acc.id };
  const db = getDb();
  const saved = await db
    .select()
    .from(schema.funnels)
    .where(and(eq(schema.funnels.workspaceId, ctx.workspaceId), eq(schema.funnels.adAccountId, acc.id)))
    .orderBy(desc(schema.funnels.createdAt));
  const tracking = trackingFromMap(acc.actionTypeMap ?? {});
  const campaigns = await q.listCampaignMeta(scope);
  const allowed = new Set(campaigns.map((c) => c.id));
  const adSets = await q.listAdSetMeta(scope);
  const allowedSets = new Set(adSets.map((s) => s.id));
  const results = [];
  for (const fn of saved) {
    const cids = fn.campaignIds.filter((id) => allowed.has(id));
    const sids = fn.adSetIds.filter((id) => allowedSets.has(id));
    let cur: Totals;
    let prev: Totals;
    if (sids.length) {
      const [a, b] = await Promise.all([
        Promise.all(sids.map((s) => q.getDailyForEntity(scope, { from: f.from, to: f.to }, { adSetId: s }))),
        Promise.all(sids.map((s) => q.getDailyForEntity(scope, { from: f.prevFrom, to: f.prevTo }, { adSetId: s }))),
      ]);
      cur = sumTotals(a.flat());
      prev = sumTotals(b.flat());
      cur.rows = a.flat().reduce((s, r) => s + r.rows, 0);
      prev.rows = b.flat().reduce((s, r) => s + r.rows, 0);
    } else {
      const ids = cids.length ? cids : null;
      [cur, prev] = await Promise.all([q.getTotals(scope, { from: f.from, to: f.to, campaignIds: ids }), q.getTotals(scope, { from: f.prevFrom, to: f.prevTo, campaignIds: ids })]);
    }
    results.push({
      id: fn.id,
      name: fn.name,
      kind: fn.kind,
      stages: fn.stages,
      campaignIds: cids,
      adSetIds: sids,
      spend: cur.spend,
      result: computeFunnel(fn.stages as Array<{ key: string; label: string; metric: FunnelMetric }>, cur, prev, tracking),
    });
  }
  return {
    funnels: results,
    tracking,
    campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, group: c.group })),
    adSets: adSets.map((s) => ({ id: s.id, name: s.name, campaignId: s.campaignId })),
    actionTypeMap: acc.actionTypeMap ?? {},
  };
}
