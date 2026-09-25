import { describe, it, expect, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupDb, createUser, createWorkspaceWith } from "./helpers/db";
import { FakeGraph } from "./helpers/fake-graph";
import { getDb, schema, closeDb } from "@/server/db";
import { getBoss, stopBoss, SYNC_QUEUE, type SyncJobData } from "@/server/queue";
import { enqueueAccountSync, scheduleDueSyncs } from "@/server/sync/enqueue";
import { runAccountSync } from "@/server/sync/runner";
import { encryptSecret } from "@/server/security/crypto";
import { addDays, todayInTimezone } from "@/lib/metrics/core";

afterAll(async () => {
  await stopBoss();
  await closeDb();
});

describe("fila de sincronização (pg-boss)", () => {
  it("processa o job em background, evita duplicatas e o agendador respeita o intervalo", async () => {
    await setupDb();
    const graph = new FakeGraph();
    const today = todayInTimezone("America/Sao_Paulo");
    graph.seedDaily(Array.from({ length: 5 }, (_, i) => addDays(today, -i)));
    const cfg = { appId: "app123", appSecret: "s", configId: "c", version: "v26.0", fetchImpl: graph.fetch };
    const db = getDb();
    const user = await createUser();
    const ws = await createWorkspaceWith(user);
    const [conn] = await db.insert(schema.providerConnections).values({ workspaceId: ws, provider: "meta", externalUserId: "u777", tokenType: "user", status: "active" }).returning();
    await db.update(schema.providerConnections).set({ tokenCiphertext: encryptSecret("EAAtoken123456789", conn.id) }).where(eq(schema.providerConnections.id, conn.id));
    const [acc] = await db.insert(schema.adAccounts).values({ workspaceId: ws, connectionId: conn.id, provider: "meta", externalId: "act_111", name: "Loja", currency: "BRL", timezoneName: "America/Sao_Paulo", isSelected: true }).returning();
    await db.insert(schema.syncJobs).values({ adAccountId: acc.id, workspaceId: ws, intervalMinutes: 15, nextRunAt: new Date(Date.now() - 1000) });

    // Agendador: enfileira a conta vencida e agenda a próxima em +15 min
    expect(await scheduleDueSyncs()).toBe(1);
    const [job] = await db.select().from(schema.syncJobs).where(eq(schema.syncJobs.adAccountId, acc.id));
    expect(job.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    // Segunda chamada imediata: nada vencido e nenhuma duplicata
    expect(await scheduleDueSyncs()).toBe(0);
    expect(await enqueueAccountSync(acc.id, ws, "manual")).toMatchObject({ enqueued: false, reason: "duplicate" });

    const boss = await getBoss("worker");
    await boss.work<SyncJobData>(SYNC_QUEUE, async ([j]) => {
      await runAccountSync(j.data, cfg, { initialHistoryDays: 5, reconciliationDays: 2, asyncThresholdDays: 30, chunkDays: 30, reachRefreshMinutes: 60 });
    });
    const deadline = Date.now() + 30_000;
    let run;
    while (Date.now() < deadline) {
      [run] = await db.select().from(schema.syncRuns).where(and(eq(schema.syncRuns.adAccountId, acc.id)));
      if (run?.status === "succeeded" || run?.status === "failed") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(run?.status).toBe("succeeded");
    const rows = await db.select().from(schema.insightsDaily).where(eq(schema.insightsDaily.adAccountId, acc.id));
    expect(rows.length).toBe(15);
    // Após concluir, uma nova solicitação volta a ser aceita
    expect((await enqueueAccountSync(acc.id, ws, "manual")).enqueued).toBe(true);
  }, 60_000);
});
