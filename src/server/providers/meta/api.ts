import { createHmac, timingSafeEqual } from "node:crypto";
import { MetaClient, type FetchLike } from "./client";
import { MetaApiError, classifyMetaError } from "./errors";
import type { GraphActionList } from "@/lib/metrics/actions";

/**
 * Chamadas específicas da Meta usadas pelo produto. Somente leitura
 * (ads_read) - nenhuma chamada de escrita em campanhas.
 */

export type MetaAppConfig = {
  appId: string;
  appSecret: string;
  configId: string;
  version: string;
  fetchImpl?: FetchLike;
};

/* ------------------------------------------------------------------ */
/* OAuth - Facebook Login for Business (fluxo manual, code grant)      */
/* ------------------------------------------------------------------ */

export function buildLoginDialogUrl(cfg: MetaAppConfig, opts: { state: string; redirectUri: string }) {
  const u = new URL(`https://www.facebook.com/${cfg.version}/dialog/oauth`);
  u.searchParams.set("client_id", cfg.appId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("state", opts.state);
  // A configuração (tipo de token, ativos e permissões - ex.: ads_read) é
  // definida no painel da Meta e referenciada por config_id, no lugar de scope.
  u.searchParams.set("config_id", cfg.configId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("override_default_response_type", "true");
  return u.toString();
}

async function appRequest<T>(cfg: MetaAppConfig, path: string, params: Record<string, string>): Promise<T> {
  const u = new URL(`https://graph.facebook.com/${cfg.version}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const f = cfg.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const res = await f(u.toString(), { method: "GET", signal: AbortSignal.timeout(30_000) });
  const json = (await res.json().catch(() => null)) as (T & { error?: Record<string, unknown> }) | null;
  if (!res.ok || !json || json.error) {
    const e = (json?.error ?? {}) as { code?: number; error_subcode?: number; message?: string };
    throw new MetaApiError(classifyMetaError(e, res.status), String(e.message ?? `HTTP ${res.status}`).replace(/EAA[A-Za-z0-9]+/g, "EAA***"), e.code, e.error_subcode, res.status);
  }
  return json;
}

/** Troca o code por token no SERVIDOR (o segredo do app nunca vai ao navegador). */
export async function exchangeCodeForToken(cfg: MetaAppConfig, code: string, redirectUri: string) {
  return appRequest<{ access_token: string; token_type?: string; expires_in?: number }>(cfg, "oauth/access_token", {
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    redirect_uri: redirectUri,
    code,
  });
}

/** Token de usuário de curta duração → longa duração (~60 dias). Não existe refresh token. */
export async function exchangeForLongLivedUserToken(cfg: MetaAppConfig, shortToken: string) {
  return appRequest<{ access_token: string; token_type?: string; expires_in?: number }>(cfg, "oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    fb_exchange_token: shortToken,
  });
}

export type DebugTokenData = {
  app_id?: string;
  type?: string; // "USER" | "SYSTEM_USER" | "PAGE" …
  is_valid: boolean;
  expires_at?: number; // 0 = não expira
  data_access_expires_at?: number;
  scopes?: string[];
  user_id?: string;
  error?: { code?: number; subcode?: number; message?: string };
};

export async function debugToken(cfg: MetaAppConfig, inputToken: string): Promise<DebugTokenData> {
  const r = await appRequest<{ data: DebugTokenData }>(cfg, "debug_token", {
    input_token: inputToken,
    access_token: `${cfg.appId}|${cfg.appSecret}`,
  });
  return r.data;
}

/* ------------------------------------------------------------------ */
/* Descoberta e estrutura                                              */
/* ------------------------------------------------------------------ */

export type MetaAdAccount = {
  id: string; // act_<id>
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
  business?: { id: string; name: string };
};

export const AD_ACCOUNT_FIELDS = "id,account_id,name,currency,timezone_name,account_status,business{id,name}";

export function client(cfg: MetaAppConfig, token: string, onCall?: () => void) {
  return new MetaClient({ accessToken: token, appSecret: cfg.appSecret, version: cfg.version, fetchImpl: cfg.fetchImpl, onCall });
}

export async function getMe(c: MetaClient) {
  return c.get<{ id: string; name?: string }>("me", { fields: "id,name" });
}

export async function getGrantedPermissions(c: MetaClient) {
  const r = await c.get<{ data: Array<{ permission: string; status: "granted" | "declined" | "expired" }> }>("me/permissions");
  return {
    granted: r.data.filter((p) => p.status === "granted").map((p) => p.permission),
    declined: r.data.filter((p) => p.status !== "granted").map((p) => p.permission),
  };
}

export async function listAdAccounts(c: MetaClient): Promise<MetaAdAccount[]> {
  return c.getAll<MetaAdAccount>("me/adaccounts", { fields: AD_ACCOUNT_FIELDS, limit: 200 });
}

export async function getAdAccount(c: MetaClient, actId: string): Promise<MetaAdAccount> {
  return c.get<MetaAdAccount>(actId, { fields: AD_ACCOUNT_FIELDS });
}

/** Revoga a autorização do app para o usuário (melhor esforço, ao desconectar). */
export async function revokeUserAuthorization(c: MetaClient) {
  await c.post("me/permissions", { method: "delete" });
}

export type MetaCampaign = {
  id: string;
  name: string;
  objective?: string;
  status?: string;
  effective_status?: string;
  buying_type?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  created_time?: string;
};
export type MetaAdSet = {
  id: string;
  name: string;
  campaign_id: string;
  status?: string;
  effective_status?: string;
  optimization_goal?: string;
  destination_type?: string;
  attribution_spec?: unknown;
};
export type MetaAd = {
  id: string;
  name: string;
  adset_id: string;
  campaign_id: string;
  status?: string;
  effective_status?: string;
  preview_shareable_link?: string;
  creative?: {
    id: string;
    thumbnail_url?: string;
    image_url?: string;
    object_type?: string;
    title?: string;
    body?: string;
    video_id?: string;
    instagram_permalink_url?: string;
    object_story_spec?: { link_data?: { link?: string }; video_data?: { call_to_action?: { value?: { link?: string } } } };
  };
};

const ALL_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO"];

export async function listCampaigns(c: MetaClient, actId: string) {
  return c.getAll<MetaCampaign>(`${actId}/campaigns`, {
    fields: "id,name,objective,status,effective_status,buying_type,daily_budget,lifetime_budget,created_time",
    effective_status: ALL_STATUSES,
  });
}
export async function listAdSets(c: MetaClient, actId: string) {
  return c.getAll<MetaAdSet>(`${actId}/adsets`, {
    fields: "id,name,campaign_id,status,effective_status,optimization_goal,destination_type,attribution_spec",
    effective_status: ALL_STATUSES,
  });
}
export async function listAds(c: MetaClient, actId: string) {
  return c.getAll<MetaAd>(`${actId}/ads`, {
    fields:
      "id,name,adset_id,campaign_id,status,effective_status,preview_shareable_link,creative{id,thumbnail_url,image_url,object_type,title,body,video_id,instagram_permalink_url,object_story_spec}",
    effective_status: ALL_STATUSES,
    thumbnail_width: 480,
    thumbnail_height: 480,
  });
}

/* ------------------------------------------------------------------ */
/* Insights                                                            */
/* ------------------------------------------------------------------ */

export type MetaInsightRow = {
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  inline_link_clicks?: string;
  reach?: string;
  frequency?: string;
  actions?: GraphActionList;
  action_values?: GraphActionList;
  publisher_platform?: string;
  platform_position?: string;
};

export const DAILY_AD_FIELDS = "ad_id,adset_id,campaign_id,spend,impressions,inline_link_clicks,actions,action_values";

/**
 * Parâmetros comuns: atribuição unificada (configuração de cada conjunto,
 * igual ao Gerenciador de Anúncios) e contagem na data da impressão.
 */
export const ATTRIBUTION_PARAMS = { use_unified_attribution_setting: "true", action_report_time: "impression" } as const;

export async function fetchDailyAdInsightsSync(c: MetaClient, actId: string, since: string, until: string) {
  return c.getAll<MetaInsightRow>(`${actId}/insights`, {
    level: "ad",
    time_increment: 1,
    time_range: { since, until },
    fields: DAILY_AD_FIELDS,
    ...ATTRIBUTION_PARAMS,
    limit: 500,
  });
}

/** Relatório assíncrono (para janelas grandes): POST → polling → leitura paginada. */
export async function fetchInsightsAsync(
  c: MetaClient,
  actId: string,
  params: Record<string, unknown>,
  opts: { pollMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void>; onProgress?: (pct: number) => void } = {},
) {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const started = Date.now();
  const { report_run_id } = await c.post<{ report_run_id: string }>(`${actId}/insights`, params);
  let wait = opts.pollMs ?? 2000;
  while (true) {
    const st = await c.get<{ async_status: string; async_percent_completion: number }>(report_run_id, {
      fields: "async_status,async_percent_completion",
    });
    opts.onProgress?.(st.async_percent_completion ?? 0);
    if (st.async_status === "Job Completed") break;
    if (st.async_status === "Job Failed" || st.async_status === "Job Skipped")
      throw new MetaApiError("transient", `Relatório assíncrono terminou com status "${st.async_status}"`);
    if (Date.now() - started > (opts.timeoutMs ?? 15 * 60_000)) throw new MetaApiError("transient", "Tempo esgotado aguardando relatório assíncrono");
    await sleep(wait);
    wait = Math.min(wait * 1.5, 15_000);
  }
  return c.getAll<MetaInsightRow>(`${report_run_id}/insights`, { limit: 500 });
}

export async function fetchDailyAdInsightsAsync(c: MetaClient, actId: string, since: string, until: string, onProgress?: (p: number) => void) {
  return fetchInsightsAsync(
    c,
    actId,
    { level: "ad", time_increment: 1, time_range: { since, until }, fields: DAILY_AD_FIELDS, ...ATTRIBUTION_PARAMS },
    { onProgress },
  );
}

/** Quebra por plataforma e posicionamento (combinação suportada: publisher_platform + platform_position). */
export async function fetchPlacementInsights(c: MetaClient, actId: string, since: string, until: string) {
  return c.getAll<MetaInsightRow>(`${actId}/insights`, {
    level: "campaign",
    time_increment: 1,
    time_range: { since, until },
    breakdowns: "publisher_platform,platform_position",
    fields: "campaign_id,spend,impressions,inline_link_clicks,actions,action_values",
    ...ATTRIBUTION_PARAMS,
  });
}

/** Alcance/frequência para o intervalo EXATO (sem time_increment - não somável). */
export async function fetchReach(c: MetaClient, actId: string, level: "account" | "campaign", since: string, until: string) {
  return c.getAll<MetaInsightRow>(`${actId}/insights`, {
    level,
    time_range: { since, until },
    fields: level === "campaign" ? "campaign_id,reach,frequency,impressions" : "reach,frequency,impressions",
  });
}

/* ------------------------------------------------------------------ */
/* signed_request (callbacks de desautorização e exclusão de dados)    */
/* ------------------------------------------------------------------ */

export function parseSignedRequest(signedRequest: string, appSecret: string): Record<string, unknown> | null {
  const [sigB64, payloadB64] = signedRequest.split(".", 2);
  if (!sigB64 || !payloadB64) return null;
  const expected = createHmac("sha256", appSecret).update(payloadB64).digest();
  const given = Buffer.from(sigB64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (payload.algorithm && String(payload.algorithm).toUpperCase() !== "HMAC-SHA256") return null;
    return payload;
  } catch {
    return null;
  }
}
