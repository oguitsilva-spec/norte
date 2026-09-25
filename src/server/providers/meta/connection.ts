import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { encryptSecret, decryptSecret, randomToken, sha256, safeEqual } from "@/server/security/crypto";
import { log } from "@/server/security/redact";
import {
  buildLoginDialogUrl,
  exchangeCodeForToken,
  exchangeForLongLivedUserToken,
  debugToken,
  client,
  getMe,
  getGrantedPermissions,
  listAdAccounts,
  revokeUserAuthorization,
  type MetaAppConfig,
} from "./api";
import { MetaApiError } from "./errors";
import { ensureSyncJob, enqueueAccountSync } from "@/server/sync/enqueue";

export const REQUIRED_SCOPES = ["ads_read"] as const;
export const NONCE_COOKIE = "norte_meta_nonce";
const STATE_TTL_MS = 10 * 60_000;

export function metaAppConfig(fetchImpl?: MetaAppConfig["fetchImpl"]): MetaAppConfig | null {
  const { META_APP_ID, META_APP_SECRET, META_LOGIN_CONFIG_ID } = process.env;
  if (!META_APP_ID || !META_APP_SECRET || !META_LOGIN_CONFIG_ID) return null;
  return { appId: META_APP_ID, appSecret: META_APP_SECRET, configId: META_LOGIN_CONFIG_ID, version: process.env.META_GRAPH_API_VERSION ?? "v26.0", fetchImpl };
}

export function metaRedirectUri() {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/meta/callback`;
}

/**
 * Início do fluxo: cria um `state` aleatório de uso único, guardado apenas
 * como hash, vinculado ao workspace, ao usuário e a um nonce em cookie
 * httpOnly deste navegador (defesa contra CSRF / login forçado).
 */
export async function startMetaConnect(cfg: MetaAppConfig, workspaceId: string, userId: string) {
  const state = randomToken(32);
  const nonce = randomToken(24);
  await getDb()
    .insert(schema.oauthStates)
    .values({
      stateHash: sha256(state),
      workspaceId,
      userId,
      provider: "meta",
      browserNonceHash: sha256(nonce),
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    });
  return { url: buildLoginDialogUrl(cfg, { state, redirectUri: metaRedirectUri() }), nonce, maxAgeSeconds: STATE_TTL_MS / 1000 };
}

export type CallbackResult =
  | { ok: true; workspaceId: string; connectionId: string; accountsFound: number }
  | { ok: false; workspaceId?: string; error: "invalid_state" | "cancelled" | "missing_permission" | "exchange_failed" | "no_accounts_access"; detail?: string };

/**
 * Consome o state de forma ATÔMICA (UPDATE … WHERE used_at IS NULL) e
 * valida: não expirado, mesmo usuário da sessão, mesmo navegador (nonce).
 */
export async function consumeOAuthState(state: string | null, nonce: string | null, sessionUserId: string) {
  if (!state || !nonce) return null;
  const db = getDb();
  const [row] = await db
    .update(schema.oauthStates)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.oauthStates.stateHash, sha256(state)),
        isNull(schema.oauthStates.usedAt),
        gt(schema.oauthStates.expiresAt, new Date()),
        eq(schema.oauthStates.provider, "meta"),
      ),
    )
    .returning();
  if (!row) return null;
  if (row.userId !== sessionUserId) return null;
  if (!safeEqual(row.browserNonceHash, sha256(nonce))) return null;
  // O usuário ainda precisa ser admin/owner do workspace no momento do retorno.
  const [m] = await db
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.workspaceId, row.workspaceId), eq(schema.memberships.userId, sessionUserId)));
  if (!m || m.role === "viewer") return null;
  return row;
}

export async function handleMetaCallback(
  cfg: MetaAppConfig,
  params: { code: string | null; state: string | null; error: string | null; errorReason: string | null },
  nonce: string | null,
  sessionUserId: string,
): Promise<CallbackResult> {
  const st = await consumeOAuthState(params.state, nonce, sessionUserId);
  if (!st) return { ok: false, error: "invalid_state" };
  const workspaceId = st.workspaceId;
  if (params.error || !params.code) return { ok: false, workspaceId, error: "cancelled", detail: params.errorReason ?? params.error ?? undefined };

  // Etapa atual: aparece no log e na tela (sem dados sensíveis) para diagnóstico.
  let step = "troca_code";
  try {
    const exchanged = await exchangeCodeForToken(cfg, params.code, metaRedirectUri());
    let token = exchanged.access_token;
    step = "debug_token";
    let info = await debugToken(cfg, token);
    if (!info.is_valid || (info.app_id && info.app_id !== cfg.appId)) {
      log.error("meta_callback_failed", { workspaceId, step, err: "token_invalid", tokenAppMatches: info.app_id === cfg.appId, valid: info.is_valid });
      return { ok: false, workspaceId, error: "exchange_failed", detail: "debug_token:token_invalid" };
    }

    // Token de usuário: troca por um de longa duração (~60 dias). Não existe refresh token.
    const tokenType = (info.type ?? "USER").toUpperCase() === "SYSTEM_USER" ? "system_user" : "user";
    if (tokenType === "user") {
      step = "longa_duracao";
      const ll = await exchangeForLongLivedUserToken(cfg, token);
      token = ll.access_token;
      info = await debugToken(cfg, token);
    }
    step = "perfil";
    const c = client(cfg, token);
    const me = await getMe(c);
    let granted = info.scopes ?? [];
    let declined: string[] = [];
    try {
      const perms = await getGrantedPermissions(c);
      granted = perms.granted;
      declined = perms.declined;
    } catch {
      /* system users podem não expor /me/permissions - usamos debug_token.scopes */
    }
    const missing = REQUIRED_SCOPES.filter((s) => !granted.includes(s));

    step = "salvar";
    const db = getDb();
    const expiresAt = info.expires_at && info.expires_at > 0 ? new Date(info.expires_at * 1000) : null;
    const dataAccessExpiresAt = info.data_access_expires_at ? new Date(info.data_access_expires_at * 1000) : null;

    const [existing] = await db
      .select({ id: schema.providerConnections.id })
      .from(schema.providerConnections)
      .where(and(eq(schema.providerConnections.workspaceId, workspaceId), eq(schema.providerConnections.provider, "meta"), eq(schema.providerConnections.externalUserId, me.id)));
    let connectionId = existing?.id;
    if (!connectionId) {
      const [created] = await db
        .insert(schema.providerConnections)
        .values({ workspaceId, provider: "meta", externalUserId: me.id, externalUserName: me.name ?? null, tokenType, createdBy: sessionUserId, status: "error" })
        .returning({ id: schema.providerConnections.id });
      connectionId = created.id;
    }
    await db
      .update(schema.providerConnections)
      .set({
        externalUserName: me.name ?? null,
        tokenType,
        // AAD = id da conexão: o ciphertext não pode ser reaproveitado em outra linha.
        tokenCiphertext: encryptSecret(token, connectionId),
        grantedScopes: granted,
        declinedScopes: declined,
        tokenExpiresAt: expiresAt,
        dataAccessExpiresAt,
        status: missing.length ? "permission_denied" : "active",
        lastCheckedAt: new Date(),
        lastErrorCode: missing.length ? "missing_scope" : null,
        lastErrorMessage: missing.length ? `Permissão obrigatória não concedida: ${missing.join(", ")}` : null,
        disconnectedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.providerConnections.id, connectionId));

    if (missing.length) return { ok: false, workspaceId, error: "missing_permission", detail: missing.join(",") };

    step = "listar_contas";
    const found = await discoverAdAccounts(cfg, workspaceId, connectionId, token);
    // Reconexão: contas que já estavam selecionadas voltam a sincronizar na hora.
    const selected = await db
      .select({ id: schema.adAccounts.id })
      .from(schema.adAccounts)
      .where(and(eq(schema.adAccounts.connectionId, connectionId), eq(schema.adAccounts.isSelected, true)));
    if (selected.length)
      await db
        .update(schema.syncJobs)
        .set({ enabled: true, nextRunAt: new Date(), consecutiveFailures: 0 })
        .where(inArray(schema.syncJobs.adAccountId, selected.map((a) => a.id)));
    log.info("meta_connected", { workspaceId, connectionId, tokenType, accounts: found });
    return { ok: true, workspaceId, connectionId, accountsFound: found };
  } catch (e) {
    const code = e instanceof MetaApiError ? `${e.kind}_${e.code ?? "x"}${e.subcode ? `_${e.subcode}` : ""}` : "interno";
    // As mensagens da Meta já passam por redação de tokens no cliente.
    log.error("meta_callback_failed", { workspaceId, step, errorCode: code, message: String((e as Error)?.message ?? e).slice(0, 300) });
    return { ok: false, workspaceId, error: "exchange_failed", detail: `${step}:${code}` };
  }
}

/** Lista as contas acessíveis e registra/atualiza (sem selecionar automaticamente). */
export async function discoverAdAccounts(cfg: MetaAppConfig, workspaceId: string, connectionId: string, token: string) {
  const db = getDb();
  const accounts = await listAdAccounts(client(cfg, token));
  for (const a of accounts) {
    await db
      .insert(schema.adAccounts)
      .values({
        workspaceId,
        connectionId,
        provider: "meta",
        externalId: a.id,
        name: a.name,
        currency: a.currency,
        timezoneName: a.timezone_name,
        accountStatus: a.account_status,
        businessName: a.business?.name ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.adAccounts.workspaceId, schema.adAccounts.provider, schema.adAccounts.externalId],
        set: { connectionId, name: a.name, currency: a.currency, timezoneName: a.timezone_name, accountStatus: a.account_status, businessName: a.business?.name ?? null, updatedAt: new Date() },
      });
  }
  return accounts.length;
}

/**
 * Seleciona as contas a sincronizar. Somente contas desta conexão e deste
 * workspace são aceitas - IDs de outros clientes são ignorados.
 */
export async function selectAdAccounts(workspaceId: string, connectionId: string, accountIds: string[], userId: string, intervalMinutes: number) {
  const db = getDb();
  const [conn] = await db
    .select()
    .from(schema.providerConnections)
    .where(and(eq(schema.providerConnections.id, connectionId), eq(schema.providerConnections.workspaceId, workspaceId)));
  if (!conn || conn.status !== "active") throw new Error("Conexão inválida ou inativa.");
  const owned = await db
    .select({ id: schema.adAccounts.id, isSelected: schema.adAccounts.isSelected })
    .from(schema.adAccounts)
    .where(and(eq(schema.adAccounts.workspaceId, workspaceId), eq(schema.adAccounts.connectionId, connectionId)));
  const allowed = new Set(owned.map((o) => o.id));
  const wanted = accountIds.filter((id) => allowed.has(id));
  const toDeselect = owned.filter((o) => o.isSelected && !wanted.includes(o.id)).map((o) => o.id);

  if (toDeselect.length) {
    await db.update(schema.adAccounts).set({ isSelected: false, updatedAt: new Date() }).where(inArray(schema.adAccounts.id, toDeselect));
    await db.update(schema.syncJobs).set({ enabled: false }).where(inArray(schema.syncJobs.adAccountId, toDeselect));
  }
  const newlySelected: string[] = [];
  for (const id of wanted) {
    const prev = owned.find((o) => o.id === id);
    await db.update(schema.adAccounts).set({ isSelected: true, updatedAt: new Date() }).where(eq(schema.adAccounts.id, id));
    await ensureSyncJob(id, workspaceId, intervalMinutes);
    if (!prev?.isSelected) newlySelected.push(id);
  }
  for (const id of newlySelected) await enqueueAccountSync(id, workspaceId, "initial", userId);
  return { selected: wanted.length, started: newlySelected.length };
}

/** Desconecta: revoga na Meta (melhor esforço), apaga o token e pausa a sincronização. Os dados históricos são mantidos. */
export async function disconnectMeta(cfg: MetaAppConfig | null, workspaceId: string, connectionId: string) {
  const db = getDb();
  const [conn] = await db
    .select()
    .from(schema.providerConnections)
    .where(and(eq(schema.providerConnections.id, connectionId), eq(schema.providerConnections.workspaceId, workspaceId)));
  if (!conn) return false;
  if (cfg && conn.tokenCiphertext && conn.tokenType === "user") {
    try {
      await revokeUserAuthorization(client(cfg, decryptSecret(conn.tokenCiphertext, conn.id)));
    } catch (e) {
      log.warn("meta_revoke_failed", { connectionId, err: e instanceof MetaApiError ? e.kind : "unknown" });
    }
  }
  await db
    .update(schema.providerConnections)
    .set({ status: "disconnected", tokenCiphertext: null, disconnectedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.providerConnections.id, conn.id));
  const accs = await db.select({ id: schema.adAccounts.id }).from(schema.adAccounts).where(eq(schema.adAccounts.connectionId, conn.id));
  if (accs.length) await db.update(schema.syncJobs).set({ enabled: false }).where(inArray(schema.syncJobs.adAccountId, accs.map((a) => a.id)));
  return true;
}

/** Verifica a saúde de uma conexão via debug_token (sem consumir cota de anúncios). */
export async function checkConnectionHealth(cfg: MetaAppConfig, connectionId: string) {
  const db = getDb();
  const [conn] = await db.select().from(schema.providerConnections).where(eq(schema.providerConnections.id, connectionId));
  if (!conn || !conn.tokenCiphertext || conn.status === "disconnected") return null;
  try {
    const info = await debugToken(cfg, decryptSecret(conn.tokenCiphertext, conn.id));
    const expiresAt = info.expires_at && info.expires_at > 0 ? new Date(info.expires_at * 1000) : null;
    const scopes = info.scopes ?? conn.grantedScopes;
    let status: (typeof schema.connectionStatusEnum.enumValues)[number] = "active";
    let msg: string | null = null;
    if (!info.is_valid) {
      status = expiresAt && expiresAt < new Date() ? "expired" : "revoked";
      msg = status === "expired" ? "A autorização da Meta expirou. Reconecte." : "A autorização foi revogada na Meta. Reconecte.";
    } else if (!scopes.includes("ads_read")) {
      status = "permission_denied";
      msg = "A permissão ads_read foi removida. Reconecte e conceda acesso de leitura.";
    }
    await db
      .update(schema.providerConnections)
      .set({ status, tokenExpiresAt: expiresAt, dataAccessExpiresAt: info.data_access_expires_at ? new Date(info.data_access_expires_at * 1000) : conn.dataAccessExpiresAt, grantedScopes: scopes, lastCheckedAt: new Date(), lastErrorMessage: msg, lastErrorCode: status === "active" ? null : status, updatedAt: new Date() })
      .where(eq(schema.providerConnections.id, conn.id));
    return status;
  } catch (e) {
    log.warn("meta_health_check_failed", { connectionId, err: e instanceof MetaApiError ? e.kind : "unknown" });
    return null;
  }
}

/** Callback de desautorização da Meta: invalida todas as conexões daquele usuário. */
export async function revokeByExternalUser(externalUserId: string, reason: "deauthorized" | "data_deletion") {
  const db = getDb();
  const conns = await db
    .update(schema.providerConnections)
    .set({ status: "revoked", tokenCiphertext: null, lastErrorCode: reason, lastErrorMessage: "Acesso removido pelo usuário no Facebook.", updatedAt: new Date() })
    .where(and(eq(schema.providerConnections.provider, "meta"), eq(schema.providerConnections.externalUserId, externalUserId)))
    .returning({ id: schema.providerConnections.id });
  if (conns.length) {
    const accs = await db.select({ id: schema.adAccounts.id }).from(schema.adAccounts).where(inArray(schema.adAccounts.connectionId, conns.map((c) => c.id)));
    if (accs.length) {
      await db.update(schema.syncJobs).set({ enabled: false }).where(inArray(schema.syncJobs.adAccountId, accs.map((a) => a.id)));
      if (reason === "data_deletion") {
        // Exclusão de dados solicitada: remove contas e todo o histórico vinculado (cascade).
        await db.delete(schema.adAccounts).where(inArray(schema.adAccounts.id, accs.map((a) => a.id)));
      }
    }
    if (reason === "data_deletion") await db.delete(schema.providerConnections).where(inArray(schema.providerConnections.id, conns.map((c) => c.id)));
  }
  return conns.length;
}
