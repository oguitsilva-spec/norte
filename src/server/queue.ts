import { PgBoss } from "pg-boss";

/**
 * Fila de jobs em Postgres (pg-boss). Sem Redis: a mesma base garante
 * durabilidade, novas tentativas e deduplicação.
 *  - SYNC_QUEUE usa a política "stately" + singletonKey = id da conta:
 *    no máximo 1 job enfileirado e 1 ativo por conta (sem duplicatas).
 */
export const SYNC_QUEUE = "sync-account";
export const SCHEDULER_QUEUE = "sync-scheduler";
export const HEALTH_QUEUE = "connection-health";

export type SyncJobData = { adAccountId: string; workspaceId: string; syncRunId: string; kind: "initial" | "incremental" | "manual" };

const g = globalThis as unknown as { __norteBoss?: Promise<PgBoss> };

async function create(role: "web" | "worker") {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL!,
    schema: "pgboss",
    application_name: `norte-${role}`,
    max: role === "web" ? 3 : 8,
    // Apenas o worker faz manutenção e cron; o processo web só enfileira.
    supervise: role === "worker",
    schedule: role === "worker",
  });
  boss.on("error", (e) => console.error(JSON.stringify({ level: "error", msg: "pgboss_error", err: String(e?.message ?? e) })));
  await boss.start();
  await ensureQueues(boss);
  return boss;
}

export async function ensureQueues(boss: PgBoss) {
  const existing = await boss.getQueue(SYNC_QUEUE);
  if (!existing)
    await boss.createQueue(SYNC_QUEUE, {
      policy: "stately",
      retryLimit: 6,
      retryDelay: 30,
      retryBackoff: true,
      retryDelayMax: 3600,
      expireInSeconds: 60 * 45,
    });
  if (!(await boss.getQueue(SCHEDULER_QUEUE))) await boss.createQueue(SCHEDULER_QUEUE, { policy: "singleton", retryLimit: 0 });
  if (!(await boss.getQueue(HEALTH_QUEUE))) await boss.createQueue(HEALTH_QUEUE, { policy: "singleton", retryLimit: 2 });
}

export function getBoss(role: "web" | "worker" = "web"): Promise<PgBoss> {
  if (!g.__norteBoss) g.__norteBoss = create(role).catch((e) => { g.__norteBoss = undefined; throw e; });
  return g.__norteBoss;
}

export async function stopBoss() {
  const b = await g.__norteBoss?.catch(() => null);
  g.__norteBoss = undefined;
  await b?.stop({ graceful: true, timeout: 20_000 } as never);
}

/**
 * O job da fila ainda vai rodar? (criado, aguardando nova tentativa ou ativo).
 * Usado para liberar execuções "na fila" cujo job já terminou ou sumiu.
 */
export async function isSyncJobPending(boss: PgBoss, jobId: string | null | undefined) {
  if (!jobId) return false;
  const job = await boss.getJobById(SYNC_QUEUE, jobId).catch(() => null);
  return Boolean(job && ["created", "retry", "active"].includes(String((job as { state?: string }).state)));
}
