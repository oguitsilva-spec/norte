import { hmacSha256Hex } from "@/server/security/crypto";
import { log, redactString } from "@/server/security/redact";
import { MetaApiError, classifyMetaError } from "./errors";

/**
 * Cliente mínimo e testável da Graph API (Marketing API).
 *  - versão fixada por configuração (META_GRAPH_API_VERSION);
 *  - appsecret_proof em toda chamada autenticada;
 *  - leitura dos cabeçalhos de uso (BUC / conta / insights) para desacelerar;
 *  - novas tentativas com backoff exponencial + jitter para erros temporários;
 *  - paginação seguindo paging.next apenas no host oficial.
 * Nunca registra tokens: tudo passa por redact.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type MetaClientOptions = {
  accessToken: string;
  appSecret: string;
  version: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  maxRetries?: number;
  /** Espera máxima dentro do cliente; acima disso o erro sobe para a fila reagendar. */
  maxInlineWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onCall?: () => void;
};

export type UsageSnapshot = {
  maxUtilPct: number;
  regainAccessMinutes: number;
};

export type Paged<T> = { data: T[]; paging?: { cursors?: { after?: string }; next?: string } };

const GRAPH_HOST = "graph.facebook.com";

export function parseUsageHeaders(h: Headers): UsageSnapshot {
  let maxUtil = 0;
  let regain = 0;
  const take = (n: unknown) => {
    const v = typeof n === "number" ? n : Number(n);
    if (Number.isFinite(v)) maxUtil = Math.max(maxUtil, v);
  };
  const tryJson = (raw: string | null) => {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const buc = tryJson(h.get("x-business-use-case-usage"));
  if (buc && typeof buc === "object") {
    for (const entries of Object.values(buc as Record<string, unknown>)) {
      for (const e of (entries as Array<Record<string, unknown>>) ?? []) {
        take(e.call_count);
        take(e.total_cputime);
        take(e.total_time);
        const r = Number(e.estimated_time_to_regain_access ?? 0);
        if (Number.isFinite(r)) regain = Math.max(regain, r);
      }
    }
  }
  const acc = tryJson(h.get("x-ad-account-usage"));
  if (acc) {
    take(acc.acc_id_util_pct);
    const reset = Number(acc.reset_time_duration ?? 0);
    if (Number.isFinite(reset) && reset > 0) regain = Math.max(regain, Math.ceil(reset / 60));
  }
  const ins = tryJson(h.get("x-fb-ads-insights-throttle"));
  if (ins) {
    take(ins.app_id_util_pct);
    take(ins.acc_id_util_pct);
  }
  const app = tryJson(h.get("x-app-usage"));
  if (app) {
    take(app.call_count);
    take(app.total_cputime);
    take(app.total_time);
  }
  return { maxUtilPct: maxUtil, regainAccessMinutes: regain };
}

export function backoffMs(attempt: number, baseMs = 1000, capMs = 60_000, rand = Math.random) {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.round(exp / 2 + rand() * (exp / 2));
}

export class MetaClient {
  private opts: Required<Omit<MetaClientOptions, "onCall">> & { onCall?: () => void };
  public lastUsage: UsageSnapshot = { maxUtilPct: 0, regainAccessMinutes: 0 };
  public calls = 0;
  private pacing = 0;

  constructor(o: MetaClientOptions) {
    this.opts = {
      fetchImpl: (u, i) => fetch(u, i),
      baseUrl: `https://${GRAPH_HOST}`,
      maxRetries: 4,
      maxInlineWaitMs: 30_000,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      // Opções passadas como undefined (ex.: fetchImpl ausente em produção) não podem apagar os padrões.
      ...(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as MetaClientOptions),
    };
  }

  private appsecretProof() {
    return hmacSha256Hex(this.opts.appSecret, this.opts.accessToken);
  }

  buildUrl(path: string, params: Record<string, unknown> = {}) {
    const url = new URL(`${this.opts.baseUrl}/${this.opts.version}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    url.searchParams.set("access_token", this.opts.accessToken);
    url.searchParams.set("appsecret_proof", this.appsecretProof());
    return url.toString();
  }

  async get<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>(this.buildUrl(path, params), { method: "GET" });
  }

  async post<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      body.set(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    body.set("access_token", this.opts.accessToken);
    body.set("appsecret_proof", this.appsecretProof());
    const url = `${this.opts.baseUrl}/${this.opts.version}/${path.replace(/^\//, "")}`;
    return this.request<T>(url, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
  }

  /** Percorre todas as páginas (com limite de segurança). */
  async getAll<T>(path: string, params: Record<string, unknown> = {}, maxPages = 200): Promise<T[]> {
    const out: T[] = [];
    let page = await this.get<Paged<T>>(path, { limit: 500, ...params });
    out.push(...(page.data ?? []));
    let pages = 1;
    while (page.paging?.next && pages < maxPages) {
      const next = new URL(page.paging.next);
      if (next.hostname !== new URL(this.opts.baseUrl).hostname) throw new MetaApiError("invalid_request", "Paginação apontou para host inesperado");
      // Reaplica credenciais: não confiamos em tokens embutidos na URL de paginação.
      next.searchParams.set("access_token", this.opts.accessToken);
      next.searchParams.set("appsecret_proof", this.appsecretProof());
      page = await this.request<Paged<T>>(next.toString(), { method: "GET" });
      out.push(...(page.data ?? []));
      pages++;
    }
    return out;
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    let attempt = 0;
      while (true) {
      // Desacelera preventivamente quando uma resposta BEM-SUCEDIDA indicou uso ≥ 90%.
      if (this.pacing) {
        await this.opts.sleep(this.pacing);
        this.pacing = 0;
      }
      let res: Response;
      try {
        this.calls++;
        this.opts.onCall?.();
        res = await this.opts.fetchImpl(url, { ...init, signal: AbortSignal.timeout(60_000) });
      } catch (e) {
        const err = new MetaApiError("transient", `Falha de rede: ${redactString(String((e as Error)?.message ?? e))}`);
        if (attempt < this.opts.maxRetries) {
          await this.opts.sleep(backoffMs(attempt++));
          continue;
        }
        throw err;
      }
      this.lastUsage = parseUsageHeaders(res.headers);
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      const errObj = (json as { error?: Record<string, unknown> } | null)?.error;
      if (res.ok && !errObj) {
        if (this.lastUsage.maxUtilPct >= 90) this.pacing = Math.min(10_000, 1_000 * (this.lastUsage.maxUtilPct - 89));
        return json as T;
      }

      const e = (errObj ?? {}) as { code?: number; error_subcode?: number; message?: string; is_transient?: boolean; fbtrace_id?: string };
      const kind = errObj ? classifyMetaError(e, res.status) : res.status >= 500 ? "transient" : "unknown";
      const regainMs = this.lastUsage.regainAccessMinutes * 60_000;
      const err = new MetaApiError(
        kind,
        redactString(e.message ?? `HTTP ${res.status}`),
        e.code,
        e.error_subcode,
        res.status,
        kind === "rate_limit" ? Math.max(regainMs, backoffMs(attempt + 2)) : undefined,
        e.fbtrace_id,
      );
      log.warn("meta_api_error", { kind, errCode: e.code, subcode: e.error_subcode, status: res.status, fbtrace: e.fbtrace_id });
      if (err.retryable && attempt < this.opts.maxRetries) {
        const wait = err.retryAfterMs ?? backoffMs(attempt);
        if (wait <= this.opts.maxInlineWaitMs) {
          attempt++;
          await this.opts.sleep(wait);
          continue;
        }
      }
      throw err;
    }
  }
}
