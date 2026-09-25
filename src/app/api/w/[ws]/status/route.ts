import { NextResponse, type NextRequest } from "next/server";
import { desc, eq, and } from "drizzle-orm";
import { requireWorkspace, AccessError, getAdAccountInWorkspace, listSelectedAdAccounts } from "@/server/tenancy/access";
import { getDb, schema } from "@/server/db";

/** Estado de sincronização para polling leve da interface (sem dados de métricas). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ ws: string }> }) {
  try {
    const { ws } = await params;
    const ctx = await requireWorkspace(ws);
    const accountId = req.nextUrl.searchParams.get("conta");
    const accounts = accountId
      ? [await getAdAccountInWorkspace(ctx.workspaceId, accountId)].filter((a): a is NonNullable<typeof a> => Boolean(a))
      : await listSelectedAdAccounts(ctx.workspaceId);
    const db = getDb();
    const out = [];
    for (const a of accounts) {
      const [run] = await db
        .select({ status: schema.syncRuns.status, progress: schema.syncRuns.progress, kind: schema.syncRuns.kind, createdAt: schema.syncRuns.createdAt })
        .from(schema.syncRuns)
        .where(and(eq(schema.syncRuns.adAccountId, a.id), eq(schema.syncRuns.workspaceId, ctx.workspaceId)))
        .orderBy(desc(schema.syncRuns.createdAt))
        .limit(1);
      out.push({
        id: a.id,
        name: a.name,
        syncStatus: a.syncStatus,
        progress: a.syncProgress,
        lastSuccessfulSyncAt: a.lastSuccessfulSyncAt,
        initialDone: Boolean(a.initialSyncCompletedAt),
        lastRun: run ?? null,
        error: a.lastErrorMessage,
        errorCode: a.lastErrorCode,
      });
    }
    return NextResponse.json({ accounts: out }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof AccessError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
