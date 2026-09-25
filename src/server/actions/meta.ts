"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { requireWorkspace, isUuid } from "@/server/tenancy/access";
import { guard } from "@/server/page-context";
import { metaAppConfig, startMetaConnect, NONCE_COOKIE, selectAdAccounts, disconnectMeta, checkConnectionHealth, discoverAdAccounts } from "@/server/providers/meta/connection";
import { decryptSecret } from "@/server/security/crypto";

/** Inicia o Facebook Login for Business (somente admin/owner). */
export async function connectMetaAction(workspaceId: string) {
  const ctx = await guard(() => requireWorkspace(workspaceId, "admin"), workspaceId);
  if (ctx.isDemo) redirect(`/w/${ctx.workspaceId}/conexoes?erro=demo`);
  const cfg = metaAppConfig();
  if (!cfg) redirect(`/w/${ctx.workspaceId}/conexoes?erro=nao_configurado`);
  const { url, nonce, maxAgeSeconds } = await startMetaConnect(cfg, ctx.workspaceId, ctx.userId);
  (await cookies()).set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // precisa voltar no redirecionamento top-level vindo do facebook.com
    path: "/api/meta/callback",
    maxAge: maxAgeSeconds,
  });
  redirect(url);
}

export async function saveAccountSelectionAction(workspaceId: string, connectionId: string, formData: FormData) {
  const ctx = await guard(() => requireWorkspace(workspaceId, "admin"), workspaceId);
  if (!isUuid(connectionId)) redirect(`/w/${ctx.workspaceId}/conexoes`);
  const ids = formData.getAll("accounts").map(String).filter(isUuid);
  const interval = ctx.settings.syncIntervalMinutes ?? Number(process.env.SYNC_INTERVAL_MINUTES ?? 15);
  const r = await selectAdAccounts(ctx.workspaceId, connectionId, ids, ctx.userId, interval);
  revalidatePath(`/w/${ctx.workspaceId}`, "layout");
  redirect(r.started > 0 ? `/w/${ctx.workspaceId}/conexoes?sincronizando=1` : `/w/${ctx.workspaceId}/conexoes`);
}

export async function disconnectMetaAction(workspaceId: string, connectionId: string) {
  const ctx = await guard(() => requireWorkspace(workspaceId, "admin"), workspaceId);
  if (!isUuid(connectionId)) return;
  await disconnectMeta(metaAppConfig(), ctx.workspaceId, connectionId);
  revalidatePath(`/w/${ctx.workspaceId}`, "layout");
}

export async function checkHealthAction(workspaceId: string, connectionId: string) {
  const ctx = await guard(() => requireWorkspace(workspaceId, "admin"), workspaceId);
  const cfg = metaAppConfig();
  if (!cfg || !isUuid(connectionId)) return;
  const [conn] = await getDb().select().from(schema.providerConnections).where(and(eq(schema.providerConnections.id, connectionId), eq(schema.providerConnections.workspaceId, ctx.workspaceId)));
  if (!conn) return;
  const status = await checkConnectionHealth(cfg, conn.id);
  if (status === "active" && conn.tokenCiphertext) await discoverAdAccounts(cfg, ctx.workspaceId, conn.id, decryptSecret(conn.tokenCiphertext, conn.id)).catch(() => 0);
  revalidatePath(`/w/${ctx.workspaceId}/conexoes`);
}
