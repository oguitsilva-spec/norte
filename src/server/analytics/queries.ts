import { and, eq, gte, lte, inArray, sql, asc, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { ZERO_TOTALS, type Totals } from "@/lib/metrics/core";
import { objectiveGroup, type ObjectiveGroup } from "@/lib/metrics/actions";

/**
 * Camada de leitura analítica. TODA consulta recebe um Scope e filtra por
 * workspace_id E ad_account_id - o isolamento entre clientes não depende
 * de o chamador lembrar de filtrar.
 */
export type Scope = { workspaceId: string; adAccountId: string };
export type RangeFilter = { from: string; to: string; campaignIds?: string[] | null };

const t = schema.insightsDaily;

const totalsColumns = {
  spend: sql<number>`coalesce(sum(${t.spend}), 0)::float8`,
  impressions: sql<number>`coalesce(sum(${t.impressions}), 0)::float8`,
  linkClicks: sql<number>`coalesce(sum(${t.linkClicks}), 0)::float8`,
  purchases: sql<number>`coalesce(sum(${t.purchases}), 0)::float8`,
  purchaseValue: sql<number>`coalesce(sum(${t.purchaseValue}), 0)::float8`,
  leads: sql<number>`coalesce(sum(${t.leads}), 0)::float8`,
  messagingConversations: sql<number>`coalesce(sum(${t.messagingConversations}), 0)::float8`,
  landingPageViews: sql<number>`coalesce(sum(${t.landingPageViews}), 0)::float8`,
  addToCart: sql<number>`coalesce(sum(${t.addToCart}), 0)::float8`,
  initiateCheckout: sql<number>`coalesce(sum(${t.initiateCheckout}), 0)::float8`,
  rows: sql<number>`count(*)::int`,
};

function where(scope: Scope, f: RangeFilter, extra: SQL[] = []) {
  const conds: SQL[] = [eq(t.workspaceId, scope.workspaceId), eq(t.adAccountId, scope.adAccountId), gte(t.date, f.from), lte(t.date, f.to), ...extra];
  if (f.campaignIds) {
    // Lista vazia = filtro que não casa nada (nunca "todas").
    conds.push(f.campaignIds.length ? inArray(t.campaignId, f.campaignIds) : sql`false`);
  }
  return and(...conds);
}

const toTotals = (r: Record<string, unknown> | undefined): Totals =>
  r ? (Object.fromEntries(Object.keys(ZERO_TOTALS).map((k) => [k, Number(r[k] ?? 0)])) as Totals) : { ...ZERO_TOTALS };

export async function getTotals(scope: Scope, f: RangeFilter, extra: SQL[] = []): Promise<Totals> {
  const [r] = await getDb().select(totalsColumns).from(t).where(where(scope, f, extra));
  return toTotals(r);
}

export async function getDaily(scope: Scope, f: RangeFilter): Promise<Array<Totals & { date: string }>> {
  const rows = await getDb()
    .select({ date: t.date, ...totalsColumns })
    .from(t)
    .where(where(scope, f))
    .groupBy(t.date)
    .orderBy(asc(t.date));
  return rows.map((r) => ({ ...toTotals(r), date: r.date }));
}

export async function getByCampaign(scope: Scope, f: RangeFilter) {
  const rows = await getDb().select({ id: t.campaignId, ...totalsColumns }).from(t).where(where(scope, f)).groupBy(t.campaignId);
  return new Map(rows.map((r) => [r.id, toTotals(r)]));
}

export async function getByAdSet(scope: Scope, f: RangeFilter, campaignId?: string) {
  const rows = await getDb()
    .select({ id: t.adSetId, ...totalsColumns })
    .from(t)
    .where(where(scope, f, campaignId ? [eq(t.campaignId, campaignId)] : []))
    .groupBy(t.adSetId);
  return new Map(rows.map((r) => [r.id, toTotals(r)]));
}

export async function getByAd(scope: Scope, f: RangeFilter, opts: { campaignId?: string; adSetId?: string } = {}) {
  const extra: SQL[] = [];
  if (opts.campaignId) extra.push(eq(t.campaignId, opts.campaignId));
  if (opts.adSetId) extra.push(eq(t.adSetId, opts.adSetId));
  const rows = await getDb().select({ id: t.adId, ...totalsColumns }).from(t).where(where(scope, f, extra)).groupBy(t.adId);
  return new Map(rows.map((r) => [r.id, toTotals(r)]));
}

export async function getDailyForEntity(scope: Scope, f: RangeFilter, entity: { campaignId?: string; adSetId?: string; adId?: string }) {
  const extra: SQL[] = [];
  if (entity.campaignId) extra.push(eq(t.campaignId, entity.campaignId));
  if (entity.adSetId) extra.push(eq(t.adSetId, entity.adSetId));
  if (entity.adId) extra.push(eq(t.adId, entity.adId));
  const rows = await getDb()
    .select({ date: t.date, ...totalsColumns })
    .from(t)
    .where(where(scope, f, extra))
    .groupBy(t.date)
    .orderBy(asc(t.date));
  return rows.map((r) => ({ ...toTotals(r), date: r.date }));
}

export async function getPlacements(scope: Scope, f: RangeFilter) {
  const p = schema.insightsPlacementDaily;
  const conds: SQL[] = [eq(p.workspaceId, scope.workspaceId), eq(p.adAccountId, scope.adAccountId), gte(p.date, f.from), lte(p.date, f.to)];
  if (f.campaignIds) conds.push(f.campaignIds.length ? inArray(p.campaignId, f.campaignIds) : sql`false`);
  return getDb()
    .select({
      platform: p.publisherPlatform,
      position: p.platformPosition,
      spend: sql<number>`sum(${p.spend})::float8`,
      impressions: sql<number>`sum(${p.impressions})::float8`,
      linkClicks: sql<number>`sum(${p.linkClicks})::float8`,
      purchases: sql<number>`sum(${p.purchases})::float8`,
      purchaseValue: sql<number>`sum(${p.purchaseValue})::float8`,
    })
    .from(p)
    .where(and(...conds))
    .groupBy(p.publisherPlatform, p.platformPosition);
}

/** Alcance exato do intervalo, se sincronizado. Nunca somado a partir de dias. */
export async function getReach(scope: Scope, from: string, to: string) {
  const r = schema.reachSnapshots;
  const rows = await getDb()
    .select()
    .from(r)
    .where(and(eq(r.workspaceId, scope.workspaceId), eq(r.adAccountId, scope.adAccountId), eq(r.dateFrom, from), eq(r.dateTo, to)));
  const account = rows.find((x) => x.level === "account");
  return {
    account: account ? { reach: account.reach, frequency: account.frequency ? Number(account.frequency) : null, fetchedAt: account.fetchedAt } : null,
    byCampaignExternalId: new Map(rows.filter((x) => x.level === "campaign").map((x) => [x.objectExternalId, { reach: x.reach, frequency: x.frequency ? Number(x.frequency) : null }])),
  };
}

export type CampaignMeta = {
  id: string;
  externalId: string;
  name: string;
  objective: string | null;
  group: ObjectiveGroup;
  status: string | null;
  effectiveStatus: string | null;
  dailyBudget: number | null;
};

export async function listCampaignMeta(scope: Scope): Promise<CampaignMeta[]> {
  const db = getDb();
  const [cs, sets] = await Promise.all([
    db.select().from(schema.campaigns).where(and(eq(schema.campaigns.workspaceId, scope.workspaceId), eq(schema.campaigns.adAccountId, scope.adAccountId))),
    db
      .select({ campaignId: schema.adSets.campaignId, dest: schema.adSets.destinationType, goal: schema.adSets.optimizationGoal })
      .from(schema.adSets)
      .where(and(eq(schema.adSets.workspaceId, scope.workspaceId), eq(schema.adSets.adAccountId, scope.adAccountId))),
  ]);
  const byCampaign = new Map<string, { dests: string[]; goals: string[] }>();
  for (const s of sets) {
    const e = byCampaign.get(s.campaignId) ?? { dests: [], goals: [] };
    if (s.dest) e.dests.push(s.dest);
    if (s.goal) e.goals.push(s.goal);
    byCampaign.set(s.campaignId, e);
  }
  return cs.map((c) => ({
    id: c.id,
    externalId: c.externalId,
    name: c.name,
    objective: c.objective,
    group: objectiveGroup(c.objective, byCampaign.get(c.id)?.dests, byCampaign.get(c.id)?.goals),
    status: c.status,
    effectiveStatus: c.effectiveStatus,
    dailyBudget: c.dailyBudget ? Number(c.dailyBudget) : null,
  }));
}

export async function listAdSetMeta(scope: Scope, campaignId?: string) {
  const conds = [eq(schema.adSets.workspaceId, scope.workspaceId), eq(schema.adSets.adAccountId, scope.adAccountId)];
  if (campaignId) conds.push(eq(schema.adSets.campaignId, campaignId));
  return getDb().select().from(schema.adSets).where(and(...conds));
}

export async function listAdMeta(scope: Scope, opts: { campaignId?: string; adSetId?: string } = {}) {
  const conds = [eq(schema.ads.workspaceId, scope.workspaceId), eq(schema.ads.adAccountId, scope.adAccountId)];
  if (opts.campaignId) conds.push(eq(schema.ads.campaignId, opts.campaignId));
  if (opts.adSetId) conds.push(eq(schema.ads.adSetId, opts.adSetId));
  return getDb().select().from(schema.ads).where(and(...conds));
}
