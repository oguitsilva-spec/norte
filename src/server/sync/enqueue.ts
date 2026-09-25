import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { getBoss, isSyncJobPending, SYNC_QUEUE, type SyncJobData } from "@/server/queue";

export type EnqueueResult = { enqueued: true; syncRunId: string } | { enqueued: false; reason: "duplicate" | "not_eligible" };

/**
 * Enfileira a sincronização de UMA conta. A política "stately" + singletonKey
 * impede duplicatas: se já houver job enfileirado para a conta, nada é criado.
 */
export async function enqueueAccountSync(
  adAccountId: string,
  workspaceId: string,
  kind: SyncJobData["kind"],
  triggeredBy?: string | null,
): Promise<EnqueueResult> {
  const db = getDb();
  const [acc] = await db
    .select({ id: schema.adAccounts.id, isSelected: schema.adAccounts.isSelected })
    .from(schema.adAccounts)
    .where(and(eq(schema.adAccounts.id, adAccountId), eq(schema.adAccounts.workspaceId, workspaceId)));
  if (!acc || !acc.isSelected) return { enqueued: false, reason: "not_eligible" };

  // Já existe execução enfileirada/rodando? Evita criar linhas órfãs.
  const [open] = await db
    .select({ id: schema.syncRuns.id, queueJobId: schema.syncRuns.queueJobId })
    .from(schema.syncRuns)
    .where(and(eq(schema.syncRuns.adAccountId, adAccountId), inArray(schema.syncRuns.status, ["queued", "running"])))
    .orderBy(desc(schema.syncRuns.createdAt))
    .limit(1);
  const boss = await getBoss("web");
  if (open) {
    // Só é duplicata se o job correspondente ainda existir na fila; senão a execução ficou órfã.
    if (await isSyncJobPending(boss, open.queueJobId)) return { enqueued: false, reason: "duplicate" };
    await db.update(schema.syncRuns).set({ status: "failed", errorCode: "stale", errorMessage: "Execução abandonada.", finishedAt: new Date() }).where(eq(schema.syncRuns.id, open.id));
  }

  const [run] = await db
    .insert(schema.syncRuns)
    .values({ workspaceId, adAccountId, kind, status: "queued", triggeredBy: triggeredBy ?? null })
    .returning({ id: schema.syncRuns.id });
  const data: SyncJobData = { adAccountId, workspaceId, syncRunId: run.id, kind };
  const jobId = await boss.send(SYNC_QUEUE, data, { singletonKey: adAccountId });
  if (!jobId) {
    await db.delete(schema.syncRuns).where(eq(schema.syncRuns.id, run.id));
    return { enqueued: false, reason: "duplicate" };
  }
  await db.update(schema.syncRuns).set({ queueJobId: jobId }).where(eq(schema.syncRuns.id, run.id));
  await db
    .update(schema.syncJobs)
    .set({ lastEnqueuedAt: new Date() })
    .where(eq(schema.syncJobs.adAccountId, adAccountId));
  return { enqueued: true, syncRunId: run.id };
}

/**
 * Agendador: roda a cada minuto no worker. Para cada conta cujo próximo
 * horário venceu, enfileira uma sincronização incremental e agenda a próxima.
 * Contas de workspaces demo e conexões inativas são ignoradas.
 */
export async function scheduleDueSyncs(now = new Date()) {
  const db = getDb();
  const due = await db
    .select({
      adAccountId: schema.syncJobs.adAccountId,
      workspaceId: schema.syncJobs.workspaceId,
      interval: schema.syncJobs.intervalMinutes,
      failures: schema.syncJobs.consecutiveFailures,
      initialDone: schema.adAccounts.initialSyncCompletedAt,
    })
    .from(schema.syncJobs)
    .innerJoin(schema.adAccounts, eq(schema.adAccounts.id, schema.syncJobs.adAccountId))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.syncJobs.workspaceId))
    .innerJoin(schema.providerConnections, eq(schema.providerConnections.id, schema.adAccounts.connectionId))
    .where(
      and(
        eq(schema.syncJobs.enabled, true),
        lte(schema.syncJobs.nextRunAt, now),
        eq(schema.adAccounts.isSelected, true),
        eq(schema.workspaces.isDemo, false),
        eq(schema.providerConnections.status, "active"),
      ),
    )
    .limit(200);
  let count = 0;
  for (const d of due) {
    // Backoff do agendamento após falhas consecutivas (máx. 6h).
    // Antes da primeira importação completa o teto é menor: o cliente está esperando os dados.
    const backoffMin = Math.min(d.initialDone ? 360 : 30, d.interval * 2 ** Math.min(d.failures, 5));
    const next = new Date(now.getTime() + (d.failures > 0 ? backoffMin : d.interval) * 60_000);
    await db.update(schema.syncJobs).set({ nextRunAt: next }).where(eq(schema.syncJobs.adAccountId, d.adAccountId));
    const r = await enqueueAccountSync(d.adAccountId, d.workspaceId, d.initialDone ? "incremental" : "initial");
    if (r.enqueued) count++;
  }
  return count;
}

export async function ensureSyncJob(adAccountId: string, workspaceId: string, intervalMinutes: number) {
  await getDb()
    .insert(schema.syncJobs)
    .values({ adAccountId, workspaceId, intervalMinutes, enabled: true, nextRunAt: new Date(Date.now() + intervalMinutes * 60_000) })
    .onConflictDoUpdate({ target: schema.syncJobs.adAccountId, set: { enabled: true, intervalMinutes, consecutiveFailures: sql`0` } });
}

/**
 * Ao iniciar o worker: execuções "na fila"/"rodando" cujo job já não existe
 * (processo reiniciado, tentativas esgotadas) são encerradas e a conta volta
 * a ser elegível imediatamente para o agendador.
 */
export async function recoverOrphanedRuns() {
  const db = getDb();
  const boss = await getBoss("worker");
  const open = await db
    .select({ id: schema.syncRuns.id, adAccountId: schema.syncRuns.adAccountId, queueJobId: schema.syncRuns.queueJobId })
    .from(schema.syncRuns)
    .where(inArray(schema.syncRuns.status, ["queued", "running"]));
  let n = 0;
  for (const r of open) {
    if (await isSyncJobPending(boss, r.queueJobId)) continue;
    await db.update(schema.syncRuns).set({ status: "failed", errorCode: "stale", errorMessage: "Execução abandonada.", finishedAt: new Date() }).where(eq(schema.syncRuns.id, r.id));
    await db.update(schema.syncJobs).set({ nextRunAt: new Date() }).where(eq(schema.syncJobs.adAccountId, r.adAccountId));
    n++;
  }
  return n;
}
