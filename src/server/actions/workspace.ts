"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db";
import { requireUser, requireWorkspace, AccessError, isUuid, getAdAccountInWorkspace } from "@/server/tenancy/access";
import { setActiveWorkspace } from "@/server/tenancy/workspaces";
import { createDemoWorkspace } from "@/server/demo/seed";
import { randomToken, sha256 } from "@/server/security/crypto";
import { sendMail } from "@/server/mail";
import { guard } from "@/server/page-context";
import { requestManualRefresh } from "@/server/sync/manual";
import { invalidateAccount } from "@/server/analytics/cache";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const fail = (e: unknown): ActionResult => ({ ok: false, error: e instanceof AccessError ? e.message : e instanceof z.ZodError ? "Dados inválidos. Revise os campos." : e instanceof Error && e.message.length < 160 ? e.message : "Não foi possível concluir." });

export async function switchWorkspaceAction(formData: FormData) {
  const id = String(formData.get("workspaceId"));
  const ctx = await guard(() => requireWorkspace(id));
  await setActiveWorkspace(ctx.userId, ctx.workspaceId);
  redirect(`/w/${ctx.workspaceId}/visao-geral`);
}

export async function createDemoAction() {
  const user = await guard(() => requireUser());
  const ws = await createDemoWorkspace(user.id);
  await setActiveWorkspace(user.id, ws.id);
  redirect(`/w/${ws.id}/visao-geral`);
}

export async function selectAccountAction(workspaceId: string, adAccountId: string) {
  const ctx = await guard(() => requireWorkspace(workspaceId));
  const acc = await getAdAccountInWorkspace(ctx.workspaceId, adAccountId);
  if (!acc || !acc.isSelected) return { ok: false as const };
  await getDb()
    .update(schema.memberships)
    .set({ selectedAdAccountId: acc.id })
    .where(and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.userId, ctx.userId)));
  return { ok: true as const };
}

/** "Atualizar agora" - permitido a qualquer membro, limitado por cooldown por conta. */
export async function refreshNowAction(workspaceId: string, adAccountId: string) {
  try {
    const ctx = await requireWorkspace(workspaceId);
    if (ctx.isDemo) return { ok: false as const, message: "No modo demonstração os dados são fictícios e não são sincronizados com a Meta." };
    const acc = await getAdAccountInWorkspace(ctx.workspaceId, adAccountId);
    if (!acc) return { ok: false as const, message: "Conta não encontrada." };
    const r = await requestManualRefresh(ctx.workspaceId, acc.id, ctx.userId);
    if (r.ok) return { ok: true as const, message: "Sincronização enfileirada. Os números serão atualizados em instantes." };
    if (r.reason === "cooldown") return { ok: false as const, message: `Aguarde ${r.retryInSec}s para pedir uma nova atualização.`, retryInSec: r.retryInSec };
    if (r.reason === "duplicate") return { ok: false as const, message: "Já existe uma sincronização em andamento para esta conta." };
    return { ok: false as const, message: "Esta conta não está conectada para sincronização." };
  } catch (e) {
    const f = fail(e);
    return { ok: false as const, message: f.ok ? "" : f.error };
  }
}

const targetsSchema = z.object({
  roasTarget: z.union([z.literal(""), z.coerce.number().min(0).max(1000)]),
  cpaTarget: z.union([z.literal(""), z.coerce.number().min(0).max(1e9)]),
  rankingMinSpend: z.union([z.literal(""), z.coerce.number().min(0).max(1e9)]),
  rankingMinResults: z.union([z.literal(""), z.coerce.number().int().min(1).max(1e6)]),
  syncIntervalMinutes: z.coerce.number().int().min(5).max(120),
  name: z.string().trim().min(2).max(80),
});

export async function saveSettingsAction(workspaceId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireWorkspace(workspaceId, "admin");
    const v = targetsSchema.parse(Object.fromEntries(formData));
    const n = (x: number | "") => (x === "" ? null : x);
    const db = getDb();
    await db
      .update(schema.workspaces)
      .set({
        name: v.name,
        settings: { ...ctx.settings, roasTarget: n(v.roasTarget), cpaTarget: n(v.cpaTarget), rankingMinSpend: n(v.rankingMinSpend), rankingMinResults: n(v.rankingMinResults), syncIntervalMinutes: v.syncIntervalMinutes },
      })
      .where(eq(schema.workspaces.id, ctx.workspaceId));
    await db.update(schema.syncJobs).set({ intervalMinutes: v.syncIntervalMinutes }).where(eq(schema.syncJobs.workspaceId, ctx.workspaceId));
    revalidatePath(`/w/${ctx.workspaceId}`, "layout");
    return { ok: true, message: "Configurações salvas." };
  } catch (e) {
    return fail(e);
  }
}

const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(["admin", "viewer"]) });

export async function inviteMemberAction(workspaceId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireWorkspace(workspaceId, "admin");
    const v = inviteSchema.parse(Object.fromEntries(formData));
    const db = getDb();
    const [already] = await db
      .select({ id: schema.user.id })
      .from(schema.memberships)
      .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.user.email, v.email)));
    if (already) return { ok: false, error: "Essa pessoa já faz parte do workspace." };
    const token = randomToken(32);
    await db.insert(schema.invitations).values({ workspaceId: ctx.workspaceId, email: v.email, role: v.role, tokenHash: sha256(token), invitedBy: ctx.userId, expiresAt: new Date(Date.now() + 7 * 86400_000) });
    const url = `${process.env.APP_URL}/convite/${token}`;
    await sendMail(v.email, `Convite para ${ctx.workspaceName} no Norte`, `${ctx.userName} convidou você para acessar o workspace "${ctx.workspaceName}" como ${v.role === "admin" ? "administrador" : "leitor"}.\n\nAceite em até 7 dias:\n${url}`);
    revalidatePath(`/w/${ctx.workspaceId}/configuracoes`);
    return { ok: true, message: `Convite enviado para ${v.email}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeInviteAction(workspaceId: string, inviteId: string) {
  const ctx = await guard(() => requireWorkspace(workspaceId, "admin"), workspaceId);
  if (!isUuid(inviteId)) return;
  await getDb().update(schema.invitations).set({ revokedAt: new Date() }).where(and(eq(schema.invitations.id, inviteId), eq(schema.invitations.workspaceId, ctx.workspaceId)));
  revalidatePath(`/w/${ctx.workspaceId}/configuracoes`);
}

export async function changeRoleAction(workspaceId: string, userId: string, role: "owner" | "admin" | "viewer"): Promise<ActionResult> {
  try {
    const ctx = await requireWorkspace(workspaceId, "admin");
    if (!["owner", "admin", "viewer"].includes(role)) throw new Error("Papel inválido.");
    const db = getDb();
    const [target] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.userId, userId)));
    if (!target) throw new AccessError(404, "Membro não encontrado.");
    if ((role === "owner" || target.role === "owner") && ctx.role !== "owner") throw new AccessError(403, "Apenas proprietários podem alterar papéis de proprietário.");
    if (target.role === "owner" && role !== "owner") {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.memberships).where(and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.role, "owner")));
      if (n <= 1) throw new Error("O workspace precisa de pelo menos um proprietário.");
    }
    await db.update(schema.memberships).set({ role }).where(and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.userId, userId)));
    revalidatePath(`/w/${ctx.workspaceId}/configuracoes`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removeMemberAction(workspaceId: string, userId: string): Promise<ActionResult> {
  try {
    const ctx = await requireWorkspace(workspaceId, "admin");
    const db = getDb();
    const [target] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.userId, userId)));
    if (!target) throw new AccessError(404, "Membro não encontrado.");
    if (target.role === "owner") {
      if (ctx.role !== "owner") throw new AccessError(403, "Apenas proprietários podem remover proprietários.");
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.memberships).where(and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.role, "owner")));
      if (n <= 1) throw new Error("O workspace precisa de pelo menos um proprietário.");
    }
    await db.delete(schema.memberships).where(and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.userId, userId)));
    revalidatePath(`/w/${ctx.workspaceId}/configuracoes`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function acceptInviteAction(token: string) {
  const user = await guard(() => requireUser());
  const db = getDb();
  const [inv] = await db
    .select()
    .from(schema.invitations)
    .where(and(eq(schema.invitations.tokenHash, sha256(token)), isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt), gt(schema.invitations.expiresAt, new Date())));
  if (!inv) redirect("/app?convite=invalido");
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) redirect(`/convite/${token}?erro=email`);
  await db.transaction(async (tx) => {
    await tx.update(schema.invitations).set({ acceptedAt: new Date() }).where(eq(schema.invitations.id, inv.id));
    await tx.insert(schema.memberships).values({ workspaceId: inv.workspaceId, userId: user.id, role: inv.role }).onConflictDoNothing();
  });
  await setActiveWorkspace(user.id, inv.workspaceId);
  redirect(`/w/${inv.workspaceId}/visao-geral`);
}

const stageSchema = z.object({
  key: z.string().min(1).max(20),
  label: z.string().trim().min(1).max(60),
  metric: z.enum(["impressions", "link_clicks", "landing_page_views", "add_to_cart", "initiate_checkout", "purchases", "leads", "messaging_conversations"]),
});
const funnelSchema = z.object({
  id: z.string().uuid().optional(),
  adAccountId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  kind: z.enum(["ecommerce", "leads", "messaging", "custom"]),
  stages: z.array(stageSchema).min(2).max(8),
  campaignIds: z.array(z.string().uuid()).max(200),
  adSetIds: z.array(z.string().uuid()).max(500),
});

export async function saveFunnelAction(workspaceId: string, input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireWorkspace(workspaceId, "admin");
    const v = funnelSchema.parse(input);
    const acc = await getAdAccountInWorkspace(ctx.workspaceId, v.adAccountId);
    if (!acc) throw new AccessError(404, "Conta não encontrada.");
    const db = getDb();
    // Só aceita campanhas/conjuntos desta conta e deste workspace.
    const camps = await db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(and(eq(schema.campaigns.workspaceId, ctx.workspaceId), eq(schema.campaigns.adAccountId, acc.id)));
    const sets = await db.select({ id: schema.adSets.id }).from(schema.adSets).where(and(eq(schema.adSets.workspaceId, ctx.workspaceId), eq(schema.adSets.adAccountId, acc.id)));
    const okC = new Set(camps.map((c) => c.id));
    const okS = new Set(sets.map((s) => s.id));
    const values = {
      name: v.name,
      kind: v.kind,
      stages: v.stages,
      campaignIds: v.campaignIds.filter((i) => okC.has(i)),
      adSetIds: v.adSetIds.filter((i) => okS.has(i)),
      updatedAt: new Date(),
    };
    if (v.id) {
      const r = await db.update(schema.funnels).set(values).where(and(eq(schema.funnels.id, v.id), eq(schema.funnels.workspaceId, ctx.workspaceId), eq(schema.funnels.adAccountId, acc.id))).returning({ id: schema.funnels.id });
      if (!r.length) throw new AccessError(404, "Funil não encontrado.");
    } else {
      await db.insert(schema.funnels).values({ ...values, workspaceId: ctx.workspaceId, adAccountId: acc.id, createdBy: ctx.userId });
    }
    invalidateAccount(ctx.workspaceId, acc.id);
    revalidatePath(`/w/${ctx.workspaceId}/funis`);
    return { ok: true, message: "Funil salvo." };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteFunnelAction(workspaceId: string, funnelId: string): Promise<ActionResult> {
  try {
    const ctx = await requireWorkspace(workspaceId, "admin");
    if (!isUuid(funnelId)) throw new AccessError(404, "Funil não encontrado.");
    await getDb().delete(schema.funnels).where(and(eq(schema.funnels.id, funnelId), eq(schema.funnels.workspaceId, ctx.workspaceId)));
    revalidatePath(`/w/${ctx.workspaceId}/funis`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
