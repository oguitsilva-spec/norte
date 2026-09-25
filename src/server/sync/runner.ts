import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { decryptSecret } from "@/server/security/crypto";
import { log, redactString } from "@/server/security/redact";
import {
  client,
  getAdAccount,
  listCampaigns,
  listAdSets,
  listAds,
  fetchDailyAdInsightsSync,
  fetchDailyAdInsightsAsync,
  fetchPlacementInsights,
  fetchReach,
  type MetaAppConfig,
  type MetaInsightRow,
} from "@/server/providers/meta/api";
import { MetaApiError, userMessageFor } from "@/server/providers/meta/errors";
import { actionListToRecord, chooseActionTypeMap, extractAll, type ActionTypeMap } from "@/lib/metrics/actions";
import { addDays, daysBetweenInclusive, todayInTimezone, resolvePreset, previousPeriod } from "@/lib/metrics/core";
import type { SyncJobData } from "@/server/queue";

export type SyncSettings = {
  initialHistoryDays: number;
  reconciliationDays: number;
  /** Janelas maiores que isso usam relatório assíncrono. */
  asyncThresholdDays: number;
  chunkDays: number;
  reachRefreshMinutes: number;
};

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  initialHistoryDays: Number(process.env.SYNC_INITIAL_HISTORY_DAYS ?? 90),
  reconciliationDays: Number(process.env.SYNC_RECONCILIATION_DAYS ?? 7),
  asyncThresholdDays: 14,
  chunkDays: 30,
  reachRefreshMinutes: 60,
};

export type SyncOutcome = { status: "succeeded" | "failed"; retry: boolean; rows: number; apiCalls: number; error?: string };

/** Erro que deve voltar para a fila (nova tentativa com backoff). */
export class RetryableSyncError extends Error {
  constructor(message: string, public retryAfterMs?: number) {
    super(message);
  }
}

/** Divide [from, to] em janelas de até `size` dias. */
export function chunkRange(from: string, to: string, size: number): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  let start = from;
  while (start <= to) {
    const end = addDays(start, size - 1) < to ? addDays(start, size - 1) : to;
    out.push({ from: start, to: end });
    start = addDays(end, 1);
  }
  return out;
}

/** Calcula a janela a sincronizar: histórico inicial ou incremental + reconciliação. */
export function computeSyncWindow(opts: {
  today: string;
  initialCompleted: boolean;
  dataThrough: string | null;
  settings: Pick<SyncSettings, "initialHistoryDays" | "reconciliationDays">;
}) {
  const { today, settings } = opts;
  if (!opts.initialCompleted || !opts.dataThrough) {
    return { from: addDays(today, -(settings.initialHistoryDays - 1)), to: today, initial: true };
  }
  const anchor = opts.dataThrough < today ? opts.dataThrough : today;
  // Reprocessa os últimos N dias: conversões atrasadas e mudanças de atribuição.
  return { from: addDays(anchor, -settings.reconciliationDays), to: today, initial: false };
}

const num = (v: string | number | undefined | null) => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export async function runAccountSync(data: SyncJobData, cfg: MetaAppConfig, settings: SyncSettings = DEFAULT_SYNC_SETTINGS, attempt = 1): Promise<SyncOutcome> {
  const db = getDb();
  const startedAt = new Date();
  let apiCalls = 0;
  let rowsUpserted = 0;

  const [account] = await db
    .select()
    .from(schema.adAccounts)
    .where(and(eq(schema.adAccounts.id, data.adAccountId), eq(schema.adAccounts.workspaceId, data.workspaceId)));

  const finishRun = async (patch: Partial<typeof schema.syncRuns.$inferInsert>) => {
    await db
      .update(schema.syncRuns)
      .set({ finishedAt: new Date(), apiCalls, rowsUpserted, ...patch })
      .where(and(eq(schema.syncRuns.id, data.syncRunId), eq(schema.syncRuns.workspaceId, data.workspaceId)));
  };

  if (!account || !account.isSelected) {
    await finishRun({ status: "failed", errorCode: "account_not_selected", errorMessage: "Conta não está mais selecionada para sincronização." });
    return { status: "failed", retry: false, rows: 0, apiCalls: 0, error: "account_not_selected" };
  }
  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, data.workspaceId));
  if (!ws || ws.isDemo) {
    await finishRun({ status: "failed", errorCode: "demo_workspace", errorMessage: "Workspaces de demonstração não sincronizam com a Meta." });
    return { status: "failed", retry: false, rows: 0, apiCalls: 0, error: "demo_workspace" };
  }
  const [conn] = account.connectionId
    ? await db
        .select()
        .from(schema.providerConnections)
        .where(and(eq(schema.providerConnections.id, account.connectionId), eq(schema.providerConnections.workspaceId, data.workspaceId)))
    : [];
  if (!conn || conn.status !== "active" || !conn.tokenCiphertext) {
    const msg = "A conexão com a Meta não está ativa. Reconecte para retomar a sincronização.";
    await db.update(schema.adAccounts).set({ syncStatus: "error", lastErrorCode: "connection_inactive", lastErrorMessage: msg, syncProgress: null, updatedAt: new Date() }).where(eq(schema.adAccounts.id, account.id));
    await finishRun({ status: "failed", errorCode: "connection_inactive", errorMessage: msg });
    return { status: "failed", retry: false, rows: 0, apiCalls: 0, error: "connection_inactive" };
  }

  const isInitial = !account.initialSyncCompletedAt;
  await db.update(schema.syncRuns).set({ status: "running", startedAt, attempt }).where(eq(schema.syncRuns.id, data.syncRunId));
  await db
    .update(schema.adAccounts)
    .set({ syncStatus: isInitial ? "initial_sync" : account.syncStatus === "permission_denied" ? "ok" : account.syncStatus, lastSyncStartedAt: startedAt, syncProgress: 0, updatedAt: new Date() })
    .where(eq(schema.adAccounts.id, account.id));

  const progress = async (p: number) => {
    const v = Math.max(0, Math.min(1, p));
    await db.update(schema.syncRuns).set({ progress: v, apiCalls, rowsUpserted }).where(eq(schema.syncRuns.id, data.syncRunId));
    await db.update(schema.adAccounts).set({ syncProgress: v }).where(eq(schema.adAccounts.id, account.id));
  };

  try {
    const token = decryptSecret(conn.tokenCiphertext, conn.id);
    const c = client(cfg, token, () => apiCalls++);
    const actId = account.externalId;

    /* 1) Metadados da conta (moeda, fuso, status) */
    const meta = await getAdAccount(c, actId);
    await db
      .update(schema.adAccounts)
      .set({ name: meta.name, currency: meta.currency, timezoneName: meta.timezone_name, accountStatus: meta.account_status, businessName: meta.business?.name ?? null, updatedAt: new Date() })
      .where(eq(schema.adAccounts.id, account.id));
    await progress(0.05);

    /* 2) Estrutura: campanhas → conjuntos → anúncios */
    const [mCampaigns, mAdSets, mAds] = [await listCampaigns(c, actId), await listAdSets(c, actId), await listAds(c, actId)];
    const idMaps = await upsertStructure(account.workspaceId, account.id, mCampaigns, mAdSets, mAds);
    await progress(0.15);

    /* 3) Insights diários por anúncio */
    const today = todayInTimezone(meta.timezone_name);
    const window = computeSyncWindow({ today, initialCompleted: !isInitial, dataThrough: account.dataThrough, settings });
    await db.update(schema.syncRuns).set({ dateFrom: window.from, dateTo: window.to, kind: isInitial ? "initial" : data.kind === "manual" ? "manual" : "incremental" }).where(eq(schema.syncRuns.id, data.syncRunId));

    const chunks = chunkRange(window.from, window.to, settings.chunkDays).reverse(); // mais recente primeiro
    let actionMap: ActionTypeMap = account.actionTypeMap ?? {};
    const present = new Set<string>();
    let done = 0;
    for (const ch of chunks) {
      const days = daysBetweenInclusive(ch.from, ch.to);
      const rows =
        days > settings.asyncThresholdDays
          ? await fetchDailyAdInsightsAsync(c, actId, ch.from, ch.to)
          : await fetchDailyAdInsightsSync(c, actId, ch.from, ch.to);
      for (const r of rows) {
        for (const a of r.actions ?? []) present.add(a.action_type);
      }
      const newMap = chooseActionTypeMap(present, actionMap);
      actionMap = newMap;
      rowsUpserted += await replaceDailyWindow(account.workspaceId, account.id, ch, rows, actionMap, idMaps);
      done++;
      await progress(0.15 + 0.6 * (done / chunks.length));
    }

    // Se o tipo canônico mudou, reprocessa todo o histórico a partir das ações brutas.
    const mapChanged = JSON.stringify(actionMap) !== JSON.stringify(account.actionTypeMap ?? {});
    if (mapChanged) {
      await db.update(schema.adAccounts).set({ actionTypeMap: actionMap }).where(eq(schema.adAccounts.id, account.id));
      await reextractAccount(account.id, actionMap);
    }

    /* 4) Posicionamentos (mesma janela, apenas incremental ou últimos 30 dias no inicial) */
    const placementFrom = isInitial ? addDays(today, -29) : window.from;
    const placement = await fetchPlacementInsights(c, actId, placementFrom, window.to);
    await replacePlacementWindow(account.workspaceId, account.id, { from: placementFrom, to: window.to }, placement, actionMap, idMaps);
    await progress(0.85);

    /* 5) Alcance/frequência para os períodos padrão (não somáveis) */
    const [job] = await db.select().from(schema.syncJobs).where(eq(schema.syncJobs.adAccountId, account.id));
    const reachDue = !job?.lastReachSnapshotAt || Date.now() - job.lastReachSnapshotAt.getTime() > settings.reachRefreshMinutes * 60_000;
    if (reachDue || isInitial) {
      await snapshotReach(c, account.workspaceId, account.id, actId, today);
      await db.update(schema.syncJobs).set({ lastReachSnapshotAt: new Date() }).where(eq(schema.syncJobs.adAccountId, account.id));
    }

    /* 6) Finalização */
    const finishedAt = new Date();
    const newFrom = account.dataFrom && account.dataFrom < window.from ? account.dataFrom : window.from;
    await db
      .update(schema.adAccounts)
      .set({
        syncStatus: "ok",
        syncProgress: null,
        lastSuccessfulSyncAt: finishedAt,
        initialSyncCompletedAt: account.initialSyncCompletedAt ?? finishedAt,
        dataThrough: window.to,
        dataFrom: newFrom,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: finishedAt,
      })
      .where(eq(schema.adAccounts.id, account.id));
    await db.update(schema.syncJobs).set({ consecutiveFailures: 0 }).where(eq(schema.syncJobs.adAccountId, account.id));
    await db.update(schema.providerConnections).set({ lastCheckedAt: finishedAt }).where(eq(schema.providerConnections.id, conn.id));
    await finishRun({ status: "succeeded", progress: 1, errorCode: null, errorMessage: null });
    log.info("sync_succeeded", { adAccountId: account.id, rows: rowsUpserted, apiCalls, ms: finishedAt.getTime() - startedAt.getTime() });
    return { status: "succeeded", retry: false, rows: rowsUpserted, apiCalls };
  } catch (e) {
    const err = e instanceof MetaApiError ? e : null;
    const message = err ? userMessageFor(err) : "Erro interno durante a sincronização.";
    const code = err ? `meta_${err.kind}${err.code ? `_${err.code}` : ""}${err.subcode ? `_${err.subcode}` : ""}` : "internal_error";
    log.error("sync_failed", { adAccountId: account.id, code, detail: redactString(String((e as Error)?.message ?? e)) });

    await db
      .update(schema.syncJobs)
      .set({ consecutiveFailures: sql`${schema.syncJobs.consecutiveFailures} + 1` })
      .where(eq(schema.syncJobs.adAccountId, account.id));

    if (err?.kind === "auth") {
      const status = err.subcode === 458 ? "revoked" : "expired";
      await db
        .update(schema.providerConnections)
        .set({ status, lastErrorCode: code, lastErrorMessage: message, lastCheckedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.providerConnections.id, conn.id));
    }
    const nextStatus =
      err?.kind === "permission" ? "permission_denied" : err?.kind === "auth" ? "error" : err?.retryable || !err ? (isInitial ? "initial_sync" : "ok") : "error";
    await db
      .update(schema.adAccounts)
      .set({ syncStatus: nextStatus, syncProgress: null, lastErrorCode: code, lastErrorMessage: message, updatedAt: new Date() })
      .where(eq(schema.adAccounts.id, account.id));

    const retry = Boolean(err?.retryable) || !err;
    await finishRun({ status: "failed", errorCode: code, errorMessage: message + (retry ? " Nova tentativa agendada automaticamente." : "") });
    if (retry) throw new RetryableSyncError(message, err?.retryAfterMs);
    return { status: "failed", retry: false, rows: rowsUpserted, apiCalls, error: code };
  }
}

/* ------------------------------------------------------------------ */

type IdMaps = {
  campaigns: Map<string, string>;
  adSets: Map<string, { id: string; campaignId: string }>;
  ads: Map<string, { id: string; adSetId: string; campaignId: string }>;
};

async function upsertStructure(
  workspaceId: string,
  adAccountId: string,
  mCampaigns: Awaited<ReturnType<typeof listCampaigns>>,
  mAdSets: Awaited<ReturnType<typeof listAdSets>>,
  mAds: Awaited<ReturnType<typeof listAds>>,
): Promise<IdMaps> {
  const db = getDb();
  const now = new Date();
  for (let i = 0; i < mCampaigns.length; i += 500) {
    const batch = mCampaigns.slice(i, i + 500).map((c) => ({
      workspaceId,
      adAccountId,
      externalId: c.id,
      name: c.name,
      objective: c.objective ?? null,
      status: c.status ?? null,
      effectiveStatus: c.effective_status ?? null,
      buyingType: c.buying_type ?? null,
      // Orçamentos vêm na menor unidade da moeda (ex.: centavos).
      dailyBudget: c.daily_budget ? String(Number(c.daily_budget) / 100) : null,
      lifetimeBudget: c.lifetime_budget ? String(Number(c.lifetime_budget) / 100) : null,
      createdTime: c.created_time ? new Date(c.created_time) : null,
      updatedAt: now,
    }));
    if (batch.length)
      await db
        .insert(schema.campaigns)
        .values(batch)
        .onConflictDoUpdate({
          target: [schema.campaigns.adAccountId, schema.campaigns.externalId],
          set: {
            name: sql`excluded.name`, objective: sql`excluded.objective`, status: sql`excluded.status`, effectiveStatus: sql`excluded.effective_status`,
            buyingType: sql`excluded.buying_type`, dailyBudget: sql`excluded.daily_budget`, lifetimeBudget: sql`excluded.lifetime_budget`, updatedAt: now,
          },
        });
  }
  const maps = await loadIdMaps(adAccountId);
  const adSetRows = mAdSets
    .filter((s) => maps.campaigns.has(s.campaign_id))
    .map((s) => ({
      workspaceId,
      adAccountId,
      campaignId: maps.campaigns.get(s.campaign_id)!,
      externalId: s.id,
      name: s.name,
      status: s.status ?? null,
      effectiveStatus: s.effective_status ?? null,
      optimizationGoal: s.optimization_goal ?? null,
      destinationType: s.destination_type ?? null,
      attributionSpec: s.attribution_spec ?? null,
      updatedAt: now,
    }));
  for (let i = 0; i < adSetRows.length; i += 500)
    await db
      .insert(schema.adSets)
      .values(adSetRows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [schema.adSets.adAccountId, schema.adSets.externalId],
        set: {
          name: sql`excluded.name`, status: sql`excluded.status`, effectiveStatus: sql`excluded.effective_status`, campaignId: sql`excluded.campaign_id`,
          optimizationGoal: sql`excluded.optimization_goal`, destinationType: sql`excluded.destination_type`, attributionSpec: sql`excluded.attribution_spec`, updatedAt: now,
        },
      });
  const maps2 = await loadIdMaps(adAccountId);
  const adRows = mAds
    .filter((a) => maps2.adSets.has(a.adset_id))
    .map((a) => {
      const cr = a.creative;
      const link = cr?.object_story_spec?.link_data?.link ?? cr?.object_story_spec?.video_data?.call_to_action?.value?.link ?? null;
      return {
        workspaceId,
        adAccountId,
        campaignId: maps2.adSets.get(a.adset_id)!.campaignId,
        adSetId: maps2.adSets.get(a.adset_id)!.id,
        externalId: a.id,
        name: a.name,
        status: a.status ?? null,
        effectiveStatus: a.effective_status ?? null,
        previewShareableLink: a.preview_shareable_link ?? null,
        creative: {
          creativeId: cr?.id ?? null,
          thumbnailUrl: cr?.thumbnail_url ?? null,
          imageUrl: cr?.image_url ?? null,
          objectType: cr?.object_type ?? null,
          title: cr?.title ?? null,
          body: cr?.body ?? null,
          linkUrl: link,
          instagramPermalinkUrl: cr?.instagram_permalink_url ?? null,
          isVideo: Boolean(cr?.video_id) || cr?.object_type === "VIDEO",
        },
        updatedAt: now,
      };
    });
  for (let i = 0; i < adRows.length; i += 500)
    await db
      .insert(schema.ads)
      .values(adRows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [schema.ads.adAccountId, schema.ads.externalId],
        set: {
          name: sql`excluded.name`, status: sql`excluded.status`, effectiveStatus: sql`excluded.effective_status`, creative: sql`excluded.creative`,
          previewShareableLink: sql`excluded.preview_shareable_link`, adSetId: sql`excluded.ad_set_id`, campaignId: sql`excluded.campaign_id`, updatedAt: now,
        },
      });
  return loadIdMaps(adAccountId);
}

async function loadIdMaps(adAccountId: string): Promise<IdMaps> {
  const db = getDb();
  const [cs, ss, as] = await Promise.all([
    db.select({ id: schema.campaigns.id, ext: schema.campaigns.externalId }).from(schema.campaigns).where(eq(schema.campaigns.adAccountId, adAccountId)),
    db.select({ id: schema.adSets.id, ext: schema.adSets.externalId, campaignId: schema.adSets.campaignId }).from(schema.adSets).where(eq(schema.adSets.adAccountId, adAccountId)),
    db.select({ id: schema.ads.id, ext: schema.ads.externalId, adSetId: schema.ads.adSetId, campaignId: schema.ads.campaignId }).from(schema.ads).where(eq(schema.ads.adAccountId, adAccountId)),
  ]);
  return {
    campaigns: new Map(cs.map((c) => [c.ext, c.id])),
    adSets: new Map(ss.map((s) => [s.ext, { id: s.id, campaignId: s.campaignId }])),
    ads: new Map(as.map((a) => [a.ext, { id: a.id, adSetId: a.adSetId, campaignId: a.campaignId }])),
  };
}

/**
 * Insights podem citar objetos excluídos (que a listagem não devolve).
 * Criamos registros "(excluído)" em vez de descartar gasto real.
 */
async function ensurePlaceholders(workspaceId: string, adAccountId: string, rows: MetaInsightRow[], maps: IdMaps) {
  const db = getDb();
  let changed = false;
  for (const r of rows) {
    if (r.campaign_id && !maps.campaigns.has(r.campaign_id)) {
      const [c] = await db
        .insert(schema.campaigns)
        .values({ workspaceId, adAccountId, externalId: r.campaign_id, name: `Campanha excluída (${r.campaign_id})`, status: "DELETED", effectiveStatus: "DELETED" })
        .onConflictDoUpdate({ target: [schema.campaigns.adAccountId, schema.campaigns.externalId], set: { updatedAt: new Date() } })
        .returning({ id: schema.campaigns.id });
      maps.campaigns.set(r.campaign_id, c.id);
      changed = true;
    }
    if (r.adset_id && r.campaign_id && !maps.adSets.has(r.adset_id)) {
      const campaignId = maps.campaigns.get(r.campaign_id)!;
      const [s] = await db
        .insert(schema.adSets)
        .values({ workspaceId, adAccountId, campaignId, externalId: r.adset_id, name: `Conjunto excluído (${r.adset_id})`, status: "DELETED", effectiveStatus: "DELETED" })
        .onConflictDoUpdate({ target: [schema.adSets.adAccountId, schema.adSets.externalId], set: { updatedAt: new Date() } })
        .returning({ id: schema.adSets.id });
      maps.adSets.set(r.adset_id, { id: s.id, campaignId });
      changed = true;
    }
    if (r.ad_id && r.adset_id && !maps.ads.has(r.ad_id)) {
      const set = maps.adSets.get(r.adset_id)!;
      const [a] = await db
        .insert(schema.ads)
        .values({ workspaceId, adAccountId, campaignId: set.campaignId, adSetId: set.id, externalId: r.ad_id, name: `Anúncio excluído (${r.ad_id})`, status: "DELETED", effectiveStatus: "DELETED" })
        .onConflictDoUpdate({ target: [schema.ads.adAccountId, schema.ads.externalId], set: { updatedAt: new Date() } })
        .returning({ id: schema.ads.id });
      maps.ads.set(r.ad_id, { id: a.id, adSetId: set.id, campaignId: set.campaignId });
      changed = true;
    }
  }
  return changed;
}

/**
 * Substitui ATOMICAMENTE a janela [from, to] da conta: apaga e reinsere na
 * mesma transação. Reexecutar o mesmo job produz exatamente o mesmo estado
 * (idempotente) e linhas que deixaram de existir na Meta são removidas.
 */
export async function replaceDailyWindow(
  workspaceId: string,
  adAccountId: string,
  range: { from: string; to: string },
  rows: MetaInsightRow[],
  map: ActionTypeMap,
  maps: IdMaps,
): Promise<number> {
  const db = getDb();
  await ensurePlaceholders(workspaceId, adAccountId, rows, maps);
  const values = rows
    .filter((r) => r.ad_id && maps.ads.has(r.ad_id) && r.date_start >= range.from && r.date_start <= range.to)
    .map((r) => {
      const ad = maps.ads.get(r.ad_id!)!;
      const actions = actionListToRecord(r.actions);
      const actionValues = actionListToRecord(r.action_values);
      const ex = extractAll(actions, actionValues, map);
      return {
        workspaceId,
        adAccountId,
        campaignId: ad.campaignId,
        adSetId: ad.adSetId,
        adId: ad.id,
        date: r.date_start,
        spend: String(num(r.spend)),
        impressions: num(r.impressions),
        linkClicks: num(r.inline_link_clicks),
        actions,
        actionValues,
        purchases: String(ex.purchases),
        purchaseValue: String(ex.purchaseValue),
        leads: String(ex.leads),
        messagingConversations: String(ex.messagingConversations),
        landingPageViews: String(ex.landingPageViews),
        addToCart: String(ex.addToCart),
        initiateCheckout: String(ex.initiateCheckout),
        syncedAt: new Date(),
      };
    });
  // Deduplica (ad, dia) - a Meta não deveria repetir, mas a chave primária exige.
  const dedup = new Map<string, (typeof values)[number]>();
  for (const v of values) dedup.set(`${v.adId}|${v.date}`, v);
  const finalRows = [...dedup.values()];
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.insightsDaily)
      .where(and(eq(schema.insightsDaily.adAccountId, adAccountId), gte(schema.insightsDaily.date, range.from), lte(schema.insightsDaily.date, range.to)));
    for (let i = 0; i < finalRows.length; i += 1000) await tx.insert(schema.insightsDaily).values(finalRows.slice(i, i + 1000));
  });
  return finalRows.length;
}

async function replacePlacementWindow(
  workspaceId: string,
  adAccountId: string,
  range: { from: string; to: string },
  rows: MetaInsightRow[],
  map: ActionTypeMap,
  maps: IdMaps,
) {
  const db = getDb();
  const agg = new Map<string, typeof schema.insightsPlacementDaily.$inferInsert>();
  for (const r of rows) {
    if (!r.campaign_id || !maps.campaigns.has(r.campaign_id)) continue;
    const actions = actionListToRecord(r.actions);
    const actionValues = actionListToRecord(r.action_values);
    const ex = extractAll(actions, actionValues, map);
    const key = `${r.campaign_id}|${r.date_start}|${r.publisher_platform}|${r.platform_position}`;
    agg.set(key, {
      workspaceId,
      adAccountId,
      campaignId: maps.campaigns.get(r.campaign_id)!,
      date: r.date_start,
      publisherPlatform: r.publisher_platform ?? "unknown",
      platformPosition: r.platform_position ?? "unknown",
      spend: String(num(r.spend)),
      impressions: num(r.impressions),
      linkClicks: num(r.inline_link_clicks),
      purchases: String(ex.purchases),
      purchaseValue: String(ex.purchaseValue),
      actions,
      actionValues,
    });
  }
  const values = [...agg.values()];
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.insightsPlacementDaily)
      .where(and(eq(schema.insightsPlacementDaily.adAccountId, adAccountId), gte(schema.insightsPlacementDaily.date, range.from), lte(schema.insightsPlacementDaily.date, range.to)));
    for (let i = 0; i < values.length; i += 1000) await tx.insert(schema.insightsPlacementDaily).values(values.slice(i, i + 1000));
  });
}

/** Reaplica o mapa canônico a todo o histórico usando as ações brutas guardadas. */
export async function reextractAccount(adAccountId: string, map: ActionTypeMap) {
  const db = getDb();
  const pick = (t: string | null | undefined, col: "actions" | "action_values") =>
    t ? sql`coalesce((${sql.raw(col)}->>${t})::numeric, 0)` : sql`0`;
  await db.execute(sql`
    update insights_daily set
      purchases = ${pick(map.purchase, "actions")},
      purchase_value = ${pick(map.purchase, "action_values")},
      leads = ${pick(map.lead, "actions")},
      messaging_conversations = ${pick(map.messaging, "actions")},
      landing_page_views = ${pick(map.landing_page_view, "actions")},
      add_to_cart = ${pick(map.add_to_cart, "actions")},
      initiate_checkout = ${pick(map.initiate_checkout, "actions")}
    where ad_account_id = ${adAccountId}`);
  await db.execute(sql`
    update insights_placement_daily set
      purchases = ${pick(map.purchase, "actions")},
      purchase_value = ${pick(map.purchase, "action_values")}
    where ad_account_id = ${adAccountId}`);
}

/** Períodos padrão do painel (e seus períodos anteriores) para alcance exato. */
export function reachPeriods(today: string) {
  const out: Array<{ from: string; to: string }> = [];
  for (const p of ["7d", "14d", "30d", "90d", "mtd", "last_month"] as const) {
    const r = resolvePreset(p, today);
    out.push(r, previousPeriod(r.from, r.to));
  }
  const seen = new Set<string>();
  return out.filter((r) => (seen.has(`${r.from}|${r.to}`) ? false : (seen.add(`${r.from}|${r.to}`), true)));
}

async function snapshotReach(c: ReturnType<typeof client>, workspaceId: string, adAccountId: string, actId: string, today: string) {
  const db = getDb();
  const periods = reachPeriods(today);
  for (const p of periods) {
    for (const level of ["account", "campaign"] as const) {
      const rows = await fetchReach(c, actId, level, p.from, p.to);
      const values = rows.map((r) => ({
        workspaceId,
        adAccountId,
        level,
        objectExternalId: level === "account" ? actId : r.campaign_id!,
        dateFrom: p.from,
        dateTo: p.to,
        reach: r.reach ? num(r.reach) : null,
        frequency: r.frequency ? String(num(r.frequency)) : null,
        impressions: r.impressions ? num(r.impressions) : null,
        fetchedAt: new Date(),
      }));
      await db.transaction(async (tx) => {
        await tx
          .delete(schema.reachSnapshots)
          .where(
            and(
              eq(schema.reachSnapshots.adAccountId, adAccountId),
              eq(schema.reachSnapshots.level, level),
              eq(schema.reachSnapshots.dateFrom, p.from),
              eq(schema.reachSnapshots.dateTo, p.to),
            ),
          );
        if (values.length) await tx.insert(schema.reachSnapshots).values(values);
      });
    }
  }
}

