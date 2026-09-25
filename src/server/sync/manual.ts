import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { enqueueAccountSync } from "./enqueue";

/**
 * "Atualizar agora": limitado por conta (cooldown configurável) para
 * proteger os limites da Meta. O controle é gravado no banco, então vale
 * entre instâncias do servidor.
 */
export async function requestManualRefresh(workspaceId: string, adAccountId: string, userId: string, now = new Date()) {
  const db = getDb();
  const cooldown = Number(process.env.MANUAL_REFRESH_COOLDOWN_SECONDS ?? 120) * 1000;
  // Reserva atômica da janela: só atualiza se o último pedido for antigo.
  const cutoff = new Date(now.getTime() - cooldown);
  const [job] = await db.select().from(schema.syncJobs).where(and(eq(schema.syncJobs.adAccountId, adAccountId), eq(schema.syncJobs.workspaceId, workspaceId)));
  if (!job) return { ok: false as const, reason: "not_connected" as const };
  if (job.lastManualRequestAt && job.lastManualRequestAt > cutoff) {
    const retryInSec = Math.ceil((job.lastManualRequestAt.getTime() + cooldown - now.getTime()) / 1000);
    return { ok: false as const, reason: "cooldown" as const, retryInSec };
  }
  const updated = await db
    .update(schema.syncJobs)
    .set({ lastManualRequestAt: now })
    .where(and(eq(schema.syncJobs.adAccountId, adAccountId), eq(schema.syncJobs.workspaceId, workspaceId), job.lastManualRequestAt ? eq(schema.syncJobs.lastManualRequestAt, job.lastManualRequestAt) : undefined))
    .returning({ id: schema.syncJobs.adAccountId });
  if (!updated.length) return { ok: false as const, reason: "cooldown" as const, retryInSec: Math.ceil(cooldown / 1000) };
  const r = await enqueueAccountSync(adAccountId, workspaceId, "manual", userId);
  if (!r.enqueued) return { ok: false as const, reason: r.reason };
  return { ok: true as const, syncRunId: r.syncRunId };
}
