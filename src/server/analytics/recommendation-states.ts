import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import type { Recommendation } from "@/lib/metrics/recommendations";

export type RecStatus = "new" | "reviewed" | "dismissed" | "snoozed";
export type RecWithStatus = Recommendation & { status: RecStatus; statusUntil: string | null };

/** Lê o status das recomendações da conta DENTRO do workspace (isolamento por workspace). */
export async function loadRecStates(workspaceId: string, adAccountId: string) {
  const rows = await getDb()
    .select()
    .from(schema.recommendationStates)
    .where(and(eq(schema.recommendationStates.workspaceId, workspaceId), eq(schema.recommendationStates.adAccountId, adAccountId)));
  return new Map(rows.map((r) => [r.recKey, r]));
}

export function applyStates(items: Recommendation[], states: Awaited<ReturnType<typeof loadRecStates>>, now = new Date()): RecWithStatus[] {
  return items.map((r) => {
    const s = states.get(r.key);
    if (!s) return { ...r, status: "new" as const, statusUntil: null };
    // "Lembrar depois" expira sozinho e a recomendação volta como nova.
    if (s.status === "snoozed" && (!s.snoozedUntil || s.snoozedUntil <= now)) return { ...r, status: "new" as const, statusUntil: null };
    return { ...r, status: s.status, statusUntil: s.snoozedUntil?.toISOString() ?? null };
  });
}
