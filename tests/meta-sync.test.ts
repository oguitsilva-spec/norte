import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { setupDb, createUser, createWorkspaceWith } from "./helpers/db";
import { FakeGraph } from "./helpers/fake-graph";
import { getDb, schema, closeDb } from "@/server/db";
import { startMetaConnect, handleMetaCallback, selectAdAccounts, disconnectMeta, revokeByExternalUser } from "@/server/providers/meta/connection";
import { runAccountSync, RetryableSyncError, computeSyncWindow, chunkRange } from "@/server/sync/runner";
import { requestManualRefresh } from "@/server/sync/manual";
import { parseSignedRequest, type MetaAppConfig } from "@/server/providers/meta/api";
import { MetaClient, parseUsageHeaders, backoffMs } from "@/server/providers/meta/client";
import { redactString } from "@/server/security/redact";
import { encryptSecret, decryptSecret } from "@/server/security/crypto";
import { stopBoss } from "@/server/queue";
import { addDays, todayInTimezone } from "@/lib/metrics/core";
import { createHmac } from "node:crypto";

let graph: FakeGraph;
let cfg: MetaAppConfig;

beforeEach(async () => {
  await setupDb();
  graph = new FakeGraph();
  cfg = { appId: "app123", appSecret: "shhh-app-secret", configId: "cfg1", version: "v26.0", fetchImpl: graph.fetch };
  process.env.APP_URL = "http://localhost:3000";
});

afterAll(async () => {
  await stopBoss();
  await closeDb();
});

async function connected() {
  const user = await createUser();
  const ws = await createWorkspaceWith(user, "owner");
  const start = await startMetaConnect(cfg, ws, user);
  const state = new URL(start.url).searchParams.get("state");
  const res = await handleMetaCallback(cfg, { code: "good", state, error: null, errorReason: null }, start.nonce, user);
  if (!res.ok) throw new Error(`callback falhou: ${res.error}`);
  return { user, ws, connectionId: res.connectionId };
}

describe("OAuth: validação de state", () => {
  it("monta a URL oficial com config_id, state e sem scope", async () => {
    const user = await createUser();
    const ws = await createWorkspaceWith(user);
    const { url } = await startMetaConnect(cfg, ws, user);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.facebook.com/v26.0/dialog/oauth");
    expect(u.searchParams.get("config_id")).toBe("cfg1");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/meta/callback");
    expect(u.searchParams.get("state")!.length).toBeGreaterThan(30);
    expect(u.searchParams.get("scope")).toBeNull();
  });

  it("rejeita state de outro navegador, de outro usuário, reutilizado ou de viewer", async () => {
    const user = await createUser();
    const other = await createUser("Intruso");
    const ws = await createWorkspaceWith(user);
    const s1 = await startMetaConnect(cfg, ws, user);
    const st1 = new URL(s1.url).searchParams.get("state");
    expect((await handleMetaCallback(cfg, { code: "good", state: st1, error: null, errorReason: null }, "nonce-errado", user)).ok).toBe(false);
    // o state foi consumido na tentativa acima - não pode ser reutilizado
    expect((await handleMetaCallback(cfg, { code: "good", state: st1, error: null, errorReason: null }, s1.nonce, user)).ok).toBe(false);

    const s2 = await startMetaConnect(cfg, ws, user);
    const st2 = new URL(s2.url).searchParams.get("state");
    const r2 = await handleMetaCallback(cfg, { code: "good", state: st2, error: null, errorReason: null }, s2.nonce, other);
    expect(r2).toMatchObject({ ok: false, error: "invalid_state" });

    const viewer = await createUser("Leitor");
    await getDb().insert(schema.memberships).values({ workspaceId: ws, userId: viewer, role: "viewer" });
    const s3 = await startMetaConnect(cfg, ws, viewer);
    const r3 = await handleMetaCallback(cfg, { code: "good", state: new URL(s3.url).searchParams.get("state"), error: null, errorReason: null }, s3.nonce, viewer);
    expect(r3).toMatchObject({ ok: false, error: "invalid_state" });

    // state expirado
    const s4 = await startMetaConnect(cfg, ws, user);
    await getDb().update(schema.oauthStates).set({ expiresAt: new Date(Date.now() - 1000) });
    const r4 = await handleMetaCallback(cfg, { code: "good", state: new URL(s4.url).searchParams.get("state"), error: null, errorReason: null }, s4.nonce, user);
    expect(r4).toMatchObject({ ok: false, error: "invalid_state" });
  });

  it("usuário que cancela na Meta volta com erro claro", async () => {
    const user = await createUser();
    const ws = await createWorkspaceWith(user);
    const s = await startMetaConnect(cfg, ws, user);
    const r = await handleMetaCallback(cfg, { code: null, state: new URL(s.url).searchParams.get("state"), error: "access_denied", errorReason: "user_denied" }, s.nonce, user);
    expect(r).toMatchObject({ ok: false, error: "cancelled", workspaceId: ws });
  });
});

describe("OAuth: troca de token e descoberta", () => {
  it("troca no servidor, gera token de longa duração, criptografa e descobre contas paginadas", async () => {
    graph.pageSize = 1; // força paginação em me/adaccounts
    const { ws, connectionId } = await connected();
    const [conn] = await getDb().select().from(schema.providerConnections).where(eq(schema.providerConnections.id, connectionId));
    expect(conn.status).toBe("active");
    expect(conn.tokenType).toBe("user");
    expect(conn.tokenCiphertext).not.toContain("EAA");
    expect(decryptSecret(conn.tokenCiphertext!, conn.id)).toBe("EAAlonglivedTOKEN123456");
    expect(conn.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 50 * 86400_000);
    const accs = await getDb().select().from(schema.adAccounts).where(eq(schema.adAccounts.workspaceId, ws));
    expect(accs.map((a) => a.externalId).sort()).toEqual(["act_111", "act_222"]);
    expect(accs.every((a) => !a.isSelected)).toBe(true);
    expect(accs.find((a) => a.externalId === "act_222")!.currency).toBe("USD");
    // O token embutido na URL de paginação nunca é usado
    expect(graph.calls.filter((c) => c === "GET me/adaccounts").length).toBe(2);
  });

  it("token de system user (Business Integration) não passa pela troca de longa duração", async () => {
    graph.tokenType = "SYSTEM_USER";
    const { connectionId } = await connected();
    expect(graph.calls).not.toContain("GET oauth/access_token?grant_type");
    const [conn] = await getDb().select().from(schema.providerConnections).where(eq(schema.providerConnections.id, connectionId));
    expect(conn.tokenType).toBe("system_user");
    expect(decryptSecret(conn.tokenCiphertext!, conn.id)).toBe("EAAshortTOKEN1234567890");
  });

  it("sem ads_read a conexão fica como permissão negada", async () => {
    graph.scopes = ["business_management"];
    const user = await createUser();
    const ws = await createWorkspaceWith(user);
    const s = await startMetaConnect(cfg, ws, user);
    const r = await handleMetaCallback(cfg, { code: "good", state: new URL(s.url).searchParams.get("state"), error: null, errorReason: null }, s.nonce, user);
    expect(r).toMatchObject({ ok: false, error: "missing_permission" });
    const [conn] = await getDb().select().from(schema.providerConnections);
    expect(conn.status).toBe("permission_denied");
  });

  it("o ciphertext é vinculado à conexão (AAD): não pode ser copiado para outra linha", () => {
    const ct = encryptSecret("EAAsegredo", "conn-a");
    expect(() => decryptSecret(ct, "conn-b")).toThrow();
  });
});

describe("isolamento na seleção de contas", () => {
  it("ignora IDs de contas de outro workspace", async () => {
    const a = await connected();
    const b = await connected();
    const bAccs = await getDb().select().from(schema.adAccounts).where(eq(schema.adAccounts.workspaceId, b.ws));
    const aAccs = await getDb().select().from(schema.adAccounts).where(eq(schema.adAccounts.workspaceId, a.ws));
    const res = await selectAdAccounts(a.ws, a.connectionId, [aAccs[0].id, bAccs[0].id], a.user, 15);
    expect(res.selected).toBe(1);
    const [bAfter] = await getDb().select().from(schema.adAccounts).where(eq(schema.adAccounts.id, bAccs[0].id));
    expect(bAfter.isSelected).toBe(false);
    // seleção cria agenda e enfileira a sincronização inicial (sem duplicar)
    const runs = await getDb().select().from(schema.syncRuns).where(eq(schema.syncRuns.workspaceId, a.ws));
    expect(runs.length).toBe(1);
    await selectAdAccounts(a.ws, a.connectionId, [aAccs[0].id], a.user, 15);
    expect((await getDb().select().from(schema.syncRuns).where(eq(schema.syncRuns.workspaceId, a.ws))).length).toBe(1);
  });
});

async function selectedAccount() {
  const c = await connected();
  const [acc] = await getDb()
    .select()
    .from(schema.adAccounts)
    .where(and(eq(schema.adAccounts.workspaceId, c.ws), eq(schema.adAccounts.externalId, "act_111")));
  await getDb().update(schema.adAccounts).set({ isSelected: true }).where(eq(schema.adAccounts.id, acc.id));
  await getDb().insert(schema.syncJobs).values({ adAccountId: acc.id, workspaceId: c.ws, intervalMinutes: 15 });
  const newRun = async () => (await getDb().insert(schema.syncRuns).values({ workspaceId: c.ws, adAccountId: acc.id, kind: "initial" }).returning())[0].id;
  return { ...c, acc, newRun };
}

describe("sincronização", () => {
  const today = todayInTimezone("America/Sao_Paulo");
  const lastDays = (n: number) => Array.from({ length: n }, (_, i) => addDays(today, -i));

  it("sincronização inicial: estrutura, paginação, assíncrono, compras sem duplicar", async () => {
    const { ws, acc, newRun } = await selectedAccount();
    graph.seedDaily(lastDays(20));
    const runId = await newRun();
    const out = await runAccountSync({ adAccountId: acc.id, workspaceId: ws, syncRunId: runId, kind: "initial" }, cfg, {
      initialHistoryDays: 20, reconciliationDays: 3, asyncThresholdDays: 7, chunkDays: 10, reachRefreshMinutes: 60,
    });
    expect(out.status).toBe("succeeded");
    expect(out.rows).toBe(60);
    expect(graph.calls.some((c) => c.startsWith("POST act_111/insights"))).toBe(true); // relatório assíncrono usado
    const [tot] = await getDb().execute<{ spend: number; purchases: number; value: number }>(
      sql`select sum(spend)::float8 spend, sum(purchases)::float8 purchases, sum(purchase_value)::float8 value from insights_daily where ad_account_id = ${acc.id}`,
    );
    expect(Number(tot.spend)).toBe(180 * 20);
    expect(Number(tot.purchases)).toBe(3 * 20); // omni_purchase apenas: não 3× (purchase + pixel)
    expect(Number(tot.value)).toBe(550 * 20);
    const [after] = await getDb().select().from(schema.adAccounts).where(eq(schema.adAccounts.id, acc.id));
    expect(after.actionTypeMap.purchase).toBe("omni_purchase");
    expect(after.syncStatus).toBe("ok");
    expect(after.dataThrough).toBe(today);
    expect(after.initialSyncCompletedAt).not.toBeNull();
    const [run] = await getDb().select().from(schema.syncRuns).where(eq(schema.syncRuns.id, runId));
    expect(run.status).toBe("succeeded");
    expect(run.apiCalls).toBeGreaterThan(5);
    const reach = await getDb().select().from(schema.reachSnapshots).where(eq(schema.reachSnapshots.adAccountId, acc.id));
    expect(reach.length).toBeGreaterThan(0);
  });

  it("é idempotente e a reconciliação remove linhas que sumiram na Meta", async () => {
    const { ws, acc, newRun } = await selectedAccount();
    graph.seedDaily(lastDays(10));
    const settings = { initialHistoryDays: 10, reconciliationDays: 3, asyncThresholdDays: 30, chunkDays: 30, reachRefreshMinutes: 60 };
    await runAccountSync({ adAccountId: acc.id, workspaceId: ws, syncRunId: await newRun(), kind: "initial" }, cfg, settings);
    const count = async () => Number((await getDb().execute<{ n: number }>(sql`select count(*)::int n from insights_daily where ad_account_id = ${acc.id}`))[0].n);
    expect(await count()).toBe(30);
    await runAccountSync({ adAccountId: acc.id, workspaceId: ws, syncRunId: await newRun(), kind: "incremental" }, cfg, settings);
    expect(await count()).toBe(30); // mesma entrada => mesmo estado
    // Meta reatribuiu: anúncio a2 deixou de ter dados ontem
    const yesterday = addDays(today, -1);
    graph.daily = graph.daily.filter((r) => !(r.ad_id === "a2" && r.date_start === yesterday));
    await runAccountSync({ adAccountId: acc.id, workspaceId: ws, syncRunId: await newRun(), kind: "incremental" }, cfg, settings);
    expect(await count()).toBe(29);
  });

  it("anúncio excluído vira registro '(excluído)' em vez de perder gasto", async () => {
    const { ws, acc, newRun } = await selectedAccount();
    graph.seedDaily(lastDays(2));
    graph.daily.push({ date_start: today, date_stop: today, ad_id: "a9", adset_id: "s9", campaign_id: "c9", spend: "12.5", impressions: "100", inline_link_clicks: "3" });
    await runAccountSync({ adAccountId: acc.id, workspaceId: ws, syncRunId: await newRun(), kind: "initial" }, cfg, { initialHistoryDays: 2, reconciliationDays: 1, asyncThresholdDays: 30, chunkDays: 30, reachRefreshMinutes: 60 });
    const [ad] = await getDb().select().from(schema.ads).where(and(eq(schema.ads.adAccountId, acc.id), eq(schema.ads.externalId, "a9")));
    expect(ad.name).toContain("excluído");
  });

  it("limite de requisição da Meta: tenta de novo com backoff e conclui", async () => {
    const { ws, acc, newRun } = await selectedAccount();
    graph.seedDaily(lastDays(3));
    graph.rateLimitOnce.add("GET act_111/campaigns");
    const out = await runAccountSync({ adAccountId: acc.id, workspaceId: ws, syncRunId: await newRun(), kind: "initial" }, cfg, { initialHistoryDays: 3, reconciliationDays: 1, asyncThresholdDays: 30, chunkDays: 30, reachRefreshMinutes: 60 });
    expect(out.status).toBe("succeeded");
    expect(graph.calls.filter((c) => c === "GET act_111/campaigns").length).toBe(2);
  });

  it("token expirado: marca conexão como expirada e NÃO reagenda", async () => {
    const { ws, acc, connectionId, newRun } = await selectedAccount();
    graph.authErrorOn = "act_111";
    const runId = await newRun();
    const out = await runAccountSync({ adAccountId: acc.id, workspaceId: ws, syncRunId: runId, kind: "incremental" }, cfg);
    expect(out).toMatchObject({ status: "failed", retry: false });
    const [conn] = await getDb().select().from(schema.providerConnections).where(eq(schema.providerConnections.id, connectionId));
    expect(conn.status).toBe("expired");
    const [run] = await getDb().select().from(schema.syncRuns).where(eq(schema.syncRuns.id, runId));
    expect(run.errorMessage).toContain("Reconecte");
    expect(run.errorMessage).not.toContain("EAA");
  });

  it("erro temporário persistente sobe para a fila como re-tentável", async () => {
    const { ws, acc, newRun } = await selectedAccount();
    const failing: MetaAppConfig = { ...cfg, fetchImpl: async () => new Response(JSON.stringify({ error: { code: 2, message: "Service temporarily unavailable", is_transient: true } }), { status: 503 }) };
    // Reduz esperas: 4 tentativas com backoff real seriam lentas; usamos backoff curto via ambiente de teste.
    await expect(runAccountSync({ adAccountId: acc.id, workspaceId: ws, syncRunId: await newRun(), kind: "incremental" }, failing)).rejects.toBeInstanceOf(RetryableSyncError);
  }, 60_000);

  it("workspace de demonstração nunca sincroniza com a Meta", async () => {
    const { ws, acc, newRun } = await selectedAccount();
    await getDb().update(schema.workspaces).set({ isDemo: true }).where(eq(schema.workspaces.id, ws));
    const out = await runAccountSync({ adAccountId: acc.id, workspaceId: ws, syncRunId: await newRun(), kind: "initial" }, cfg);
    expect(out.error).toBe("demo_workspace");
    expect(graph.calls.filter((c) => c.includes("act_111")).length).toBe(0);
  });

  it("job com workspace trocado (IDs cruzados) não toca a conta de outro cliente", async () => {
    const a = await selectedAccount();
    const b = await connected();
    const runId = await a.newRun();
    const out = await runAccountSync({ adAccountId: a.acc.id, workspaceId: b.ws, syncRunId: runId, kind: "initial" }, cfg);
    expect(out.error).toBe("account_not_selected");
    expect(graph.calls.filter((c) => c.includes("act_111/")).length).toBe(0);
  });
});

describe("Atualizar agora e desconexão", () => {
  it("aplica cooldown por conta", async () => {
    const { ws, acc, user } = await selectedAccount();
    const r1 = await requestManualRefresh(ws, acc.id, user);
    expect(r1.ok).toBe(true);
    const r2 = await requestManualRefresh(ws, acc.id, user);
    expect(r2).toMatchObject({ ok: false, reason: "cooldown" });
  });

  it("desconectar apaga o token e pausa as agendas; callback de desautorização revoga", async () => {
    const { ws, acc, connectionId } = await selectedAccount();
    await disconnectMeta(cfg, ws, connectionId);
    const [conn] = await getDb().select().from(schema.providerConnections).where(eq(schema.providerConnections.id, connectionId));
    expect(conn.tokenCiphertext).toBeNull();
    expect(conn.status).toBe("disconnected");
    const [job] = await getDb().select().from(schema.syncJobs).where(eq(schema.syncJobs.adAccountId, acc.id));
    expect(job.enabled).toBe(false);

    const c2 = await connected();
    expect(await revokeByExternalUser("u777", "deauthorized")).toBeGreaterThan(0);
    const [conn2] = await getDb().select().from(schema.providerConnections).where(eq(schema.providerConnections.id, c2.connectionId));
    expect(conn2.status).toBe("revoked");
  });
});

describe("utilitários do cliente Meta", () => {
  it("valida signed_request com HMAC", () => {
    const payload = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "u777" })).toString("base64url");
    const sig = createHmac("sha256", "shhh-app-secret").update(payload).digest("base64url");
    expect(parseSignedRequest(`${sig}.${payload}`, "shhh-app-secret")).toMatchObject({ user_id: "u777" });
    expect(parseSignedRequest(`${sig}.${payload}`, "outro-segredo")).toBeNull();
  });
  it("lê cabeçalhos de uso e calcula backoff com teto", () => {
    const h = new Headers({ "x-business-use-case-usage": JSON.stringify({ "1": [{ call_count: 95, total_time: 10, total_cputime: 5, estimated_time_to_regain_access: 7 }] }) });
    expect(parseUsageHeaders(h)).toEqual({ maxUtilPct: 95, regainAccessMinutes: 7 });
    expect(backoffMs(20, 1000, 60_000, () => 1)).toBe(60_000);
    expect(backoffMs(0, 1000, 60_000, () => 0)).toBe(500);
  });
  it("redige tokens e segredos", () => {
    expect(redactString("https://graph.facebook.com/me?access_token=EAAabc123456789012&appsecret_proof=xyz")).not.toMatch(/EAAabc|xyz/);
    const c = new MetaClient({ accessToken: "EAAsecret", appSecret: "s", version: "v26.0" });
    expect(redactString(c.buildUrl("me"))).not.toContain("EAAsecret");
  });
  it("janela de sincronização e divisão em blocos", () => {
    expect(computeSyncWindow({ today: "2026-09-24", initialCompleted: false, dataThrough: null, settings: { initialHistoryDays: 90, reconciliationDays: 7 } })).toEqual({ from: "2026-06-27", to: "2026-09-24", initial: true });
    expect(computeSyncWindow({ today: "2026-09-24", initialCompleted: true, dataThrough: "2026-09-24", settings: { initialHistoryDays: 90, reconciliationDays: 7 } })).toEqual({ from: "2026-09-17", to: "2026-09-24", initial: false });
    expect(chunkRange("2026-01-01", "2026-03-01", 30)).toEqual([
      { from: "2026-01-01", to: "2026-01-30" },
      { from: "2026-01-31", to: "2026-03-01" },
    ]);
  });
});
