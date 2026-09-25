/**
 * Graph API falsa (em memória) para testar OAuth, paginação, relatórios
 * assíncronos, limites de requisição e sincronização SEM chamar a Meta.
 */
type Row = Record<string, unknown> & { date_start: string; date_stop: string };

export class FakeGraph {
  calls: string[] = [];
  tokenValid = true;
  tokenType: "USER" | "SYSTEM_USER" = "USER";
  scopes = ["ads_read", "business_management"];
  rateLimitOnce = new Set<string>();
  authErrorOn: string | null = null;
  pageSize = 3;
  asyncPolls = 0;
  accounts = [
    { id: "act_111", account_id: "111", name: "Loja Aurora", currency: "BRL", timezone_name: "America/Sao_Paulo", account_status: 1 },
    { id: "act_222", account_id: "222", name: "Aurora US", currency: "USD", timezone_name: "America/Los_Angeles", account_status: 1 },
  ];
  campaigns = [
    { id: "c1", name: "Vendas | Prospecção", objective: "OUTCOME_SALES", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "15000" },
    { id: "c2", name: "Vendas | Remarketing", objective: "OUTCOME_SALES", status: "ACTIVE", effective_status: "ACTIVE" },
  ];
  adsets = [
    { id: "s1", name: "Amplo BR", campaign_id: "c1", optimization_goal: "OFFSITE_CONVERSIONS" },
    { id: "s2", name: "Visitantes 30d", campaign_id: "c2", optimization_goal: "OFFSITE_CONVERSIONS" },
  ];
  ads = [
    { id: "a1", name: "Vídeo depoimento", adset_id: "s1", campaign_id: "c1", creative: { id: "cr1", thumbnail_url: "https://scontent.fbcdn.net/t1.jpg" } },
    { id: "a2", name: "Carrossel", adset_id: "s1", campaign_id: "c1", creative: { id: "cr2" } },
    { id: "a3", name: "Oferta", adset_id: "s2", campaign_id: "c2", creative: { id: "cr3" } },
  ];
  /** Linhas diárias por anúncio (pode incluir anúncio excluído "a9"). */
  daily: Row[] = [];

  seedDaily(days: string[]) {
    this.daily = [];
    for (const d of days) {
      for (const [ad, set, camp, spend, pur, val] of [
        ["a1", "s1", "c1", 100, 2, 400],
        ["a2", "s1", "c1", 50, 0, 0],
        ["a3", "s2", "c2", 30, 1, 150],
      ] as const) {
        this.daily.push({
          date_start: d,
          date_stop: d,
          ad_id: ad,
          adset_id: set,
          campaign_id: camp,
          spend: String(spend),
          impressions: String(spend * 100),
          inline_link_clicks: String(spend),
          actions: [
            { action_type: "omni_purchase", value: String(pur) },
            { action_type: "purchase", value: String(pur) },
            { action_type: "offsite_conversion.fb_pixel_purchase", value: String(pur) },
            { action_type: "landing_page_view", value: String(spend * 0.8) },
          ],
          action_values: [
            { action_type: "omni_purchase", value: String(val) },
            { action_type: "offsite_conversion.fb_pixel_purchase", value: String(val) },
          ],
        });
      }
    }
  }

  private json(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }
  private err(code: number, message: string, status = 400, subcode?: number, headers: Record<string, string> = {}) {
    return this.json({ error: { code, message, error_subcode: subcode, type: "OAuthException", fbtrace_id: "trace" } }, status, headers);
  }
  private page<T>(items: T[], url: URL) {
    const after = Number(url.searchParams.get("after") ?? 0);
    const slice = items.slice(after, after + this.pageSize);
    const next = after + this.pageSize < items.length ? new URL(url.toString()) : null;
    if (next) {
      next.searchParams.set("after", String(after + this.pageSize));
      next.searchParams.set("access_token", "EAAembeddedTOKENshouldBEreplaced");
    }
    return this.json({ data: slice, paging: next ? { next: next.toString() } : undefined });
  }

  fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const body = init?.body instanceof URLSearchParams ? init.body : null;
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "");
    const method = init?.method ?? "GET";
    this.calls.push(`${method} ${path}`);
    const token = url.searchParams.get("access_token") ?? body?.get("access_token") ?? "";

    if (path === "oauth/access_token") {
      if (url.searchParams.get("code") === "bad") return this.err(100, "Invalid verification code");
      if (url.searchParams.get("grant_type") === "fb_exchange_token") return this.json({ access_token: "EAAlonglivedTOKEN123456", expires_in: 5184000 });
      return this.json({ access_token: "EAAshortTOKEN1234567890" });
    }
    if (path === "debug_token") {
      return this.json({ data: { app_id: "app123", type: this.tokenType, is_valid: this.tokenValid, expires_at: Math.floor(Date.now() / 1000) + 5184000, data_access_expires_at: Math.floor(Date.now() / 1000) + 7776000, scopes: this.scopes, user_id: "u777" } });
    }
    // Chamadas autenticadas exigem appsecret_proof e token.
    if (!url.searchParams.get("appsecret_proof") && !body?.get("appsecret_proof")) return this.err(100, "appsecret_proof missing");
    if (token.includes("embedded")) return this.err(190, "token vazado da paginação foi usado", 401);
    if (!this.tokenValid || (this.authErrorOn && path.startsWith(this.authErrorOn))) return this.err(190, "Error validating access token: Session has expired", 401, 463);
    const rlKey = `${method} ${path}`;
    if (this.rateLimitOnce.has(rlKey)) {
      this.rateLimitOnce.delete(rlKey);
      return this.err(80000, "There have been too many calls from this ad-account.", 400, 2446079, {
        "x-business-use-case-usage": JSON.stringify({ "111": [{ type: "ads_insights", call_count: 100, total_cputime: 20, total_time: 30, estimated_time_to_regain_access: 0 }] }),
      });
    }

    if (path === "me") return this.json({ id: "u777", name: "Ana Meta" });
    if (path === "me/permissions") {
      if (method === "POST") return this.json({ success: true });
      return this.json({ data: this.scopes.map((p) => ({ permission: p, status: "granted" })) });
    }
    if (path === "me/adaccounts") return this.page(this.accounts, url);
    const acc = this.accounts.find((a) => path === a.id);
    if (acc) return this.json(acc);
    if (/^act_\d+\/campaigns$/.test(path)) return this.page(this.campaigns, url);
    if (/^act_\d+\/adsets$/.test(path)) return this.page(this.adsets, url);
    if (/^act_\d+\/ads$/.test(path)) return this.page(this.ads, url);
    if (/^act_\d+\/insights$/.test(path) && method === "POST") {
      this.lastAsyncParams = body;
      this.asyncPolls = 0;
      return this.json({ report_run_id: "rr_1" });
    }
    if (path === "rr_1") {
      this.asyncPolls++;
      return this.json(this.asyncPolls < 2 ? { async_status: "Job Running", async_percent_completion: 50 } : { async_status: "Job Completed", async_percent_completion: 100 });
    }
    if (path === "rr_1/insights" || /^act_\d+\/insights$/.test(path)) {
      const params = path === "rr_1/insights" ? this.lastAsyncParams : url.searchParams;
      if (path !== "rr_1/insights") this.lastAsyncParams = url.searchParams;
      const tr = JSON.parse(params?.get("time_range") ?? "{}");
      const inRange = (d: string) => (!tr.since || d >= tr.since) && (!tr.until || d <= tr.until);
      if (params?.get("breakdowns")) {
        const rows = this.daily.filter((r) => inRange(r.date_start)).map((r) => ({ ...r, publisher_platform: "instagram", platform_position: "feed" }));
        return this.page(rows, url);
      }
      if (!params?.get("time_increment")) {
        return this.json({ data: params?.get("level") === "campaign" ? [{ campaign_id: "c1", reach: "900", frequency: "1.8", impressions: "1620", date_start: tr.since, date_stop: tr.until }] : [{ reach: "1000", frequency: "2.1", impressions: "2100", date_start: tr.since, date_stop: tr.until }] });
      }
      return this.page(this.daily.filter((r) => inRange(r.date_start)), url);
    }
    return this.err(100, `Unknown path ${path}`, 404);
  };
  lastAsyncParams: URLSearchParams | null = null;
}
