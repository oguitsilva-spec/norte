import "dotenv/config";
import { eq, and, lte, isNotNull, ne } from "drizzle-orm";
import { getBoss, stopBoss, SYNC_QUEUE, SCHEDULER_QUEUE, HEALTH_QUEUE, type SyncJobData } from "@/server/queue";
import { runAccountSync, RetryableSyncError } from "@/server/sync/runner";
import { scheduleDueSyncs } from "@/server/sync/enqueue";
import { metaAppConfig, checkConnectionHealth } from "@/server/providers/meta/connection";
import { getDb, schema, closeDb } from "@/server/db";
import { log } from "@/server/security/redact";

/**
 * Processo de background - roda independentemente de haver alguém com o
 * painel aberto. Responsável por:
 *  - agendador (a cada minuto) que enfileira contas vencidas;
 *  - execução das sincronizações (concorrência limitada);
 *  - verificação diária da saúde das conexões (debug_token).
 */
async function main() {
  const boss = await getBoss("worker");
  const cfg = metaAppConfig();
  if (!cfg) log.warn("META_APP_ID/SECRET/CONFIG_ID ausentes: nenhuma conta real será sincronizada (modo demonstração continua funcionando).");

  await boss.schedule(SCHEDULER_QUEUE, "* * * * *");
  await boss.schedule(HEALTH_QUEUE, "17 */6 * * *");

  await boss.work(SCHEDULER_QUEUE, async () => {
    const n = await scheduleDueSyncs();
    if (n) log.info("scheduler_enqueued", { count: n });
  });

  await boss.work<SyncJobData>(SYNC_QUEUE, { localConcurrency: Number(process.env.SYNC_CONCURRENCY ?? 3) }, async ([job]) => {
    if (!cfg) {
      await getDb()
        .update(schema.syncRuns)
        .set({ status: "failed", errorCode: "meta_not_configured", errorMessage: "Integração Meta não configurada neste ambiente.", finishedAt: new Date() })
        .where(eq(schema.syncRuns.id, job.data.syncRunId));
      return;
    }
    const attempt = ((job as unknown as { retryCount?: number }).retryCount ?? 0) + 1;
    try {
      await runAccountSync(job.data, cfg, undefined, attempt);
    } catch (e) {
      if (e instanceof RetryableSyncError) {
        await getDb().update(schema.syncRuns).set({ status: "queued" }).where(eq(schema.syncRuns.id, job.data.syncRunId));
        throw e; // pg-boss aplica retry com backoff exponencial
      }
      throw e;
    }
  });

  await boss.work(HEALTH_QUEUE, async () => {
    if (!cfg) return;
    const db = getDb();
    const conns = await db
      .select({ id: schema.providerConnections.id })
      .from(schema.providerConnections)
      .where(and(isNotNull(schema.providerConnections.tokenCiphertext), ne(schema.providerConnections.status, "disconnected")));
    for (const c of conns) await checkConnectionHealth(cfg, c.id);
    // Tokens vencidos pela data informada pela Meta.
    await db
      .update(schema.providerConnections)
      .set({ status: "expired", lastErrorMessage: "A autorização da Meta expirou. Reconecte.", updatedAt: new Date() })
      .where(and(eq(schema.providerConnections.status, "active"), lte(schema.providerConnections.tokenExpiresAt, new Date())));
  });

  log.info("worker_started", { queues: [SYNC_QUEUE, SCHEDULER_QUEUE, HEALTH_QUEUE] });
  const shutdown = async () => {
    log.info("worker_stopping");
    await stopBoss();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
