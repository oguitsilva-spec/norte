"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { requireWorkspace, getAdAccountInWorkspace, isUuid } from "@/server/tenancy/access";
import { guard } from "@/server/page-context";

const KEY_RE = /^[a-z_]{3,40}:[a-z0-9-]{3,64}$/;
const SNOOZE_DAYS = 7;

/**
 * Marca uma recomendação como revisada, dispensada ou "lembrar depois" (7 dias),
 * ou volta ao estado novo. Apenas admin/owner. Não altera nada na Meta.
 */
export async function setRecommendationStatusAction(workspaceId: string, adAccountId: string, recKey: string, status: "reviewed" | "dismissed" | "snoozed" | "reset") {
  const ctx = await guard(() => requireWorkspace(workspaceId, "admin"), workspaceId);
  if (!isUuid(adAccountId) || !KEY_RE.test(recKey) || !["reviewed", "dismissed", "snoozed", "reset"].includes(status)) return { ok: false as const };
  // A conta precisa pertencer a ESTE workspace.
  const acc = await getAdAccountInWorkspace(ctx.workspaceId, adAccountId);
  if (!acc) return { ok: false as const };
  const db = getDb();
  const t = schema.recommendationStates;
  if (status === "reset") {
    await db.delete(t).where(and(eq(t.workspaceId, ctx.workspaceId), eq(t.adAccountId, acc.id), eq(t.recKey, recKey)));
  } else {
    const snoozedUntil = status === "snoozed" ? new Date(Date.now() + SNOOZE_DAYS * 86_400_000) : null;
    await db
      .insert(t)
      .values({ workspaceId: ctx.workspaceId, adAccountId: acc.id, recKey, status, snoozedUntil, updatedBy: ctx.userId })
      .onConflictDoUpdate({ target: [t.workspaceId, t.adAccountId, t.recKey], set: { status, snoozedUntil, updatedBy: ctx.userId, updatedAt: new Date() } });
  }
  revalidatePath(`/w/${ctx.workspaceId}`, "layout");
  return { ok: true as const };
}
