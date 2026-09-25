import { describe, it, expect, afterAll } from "vitest";
import { setupDb, createUser, createWorkspaceWith } from "./helpers/db";
import { getDb, schema, closeDb } from "@/server/db";
import { loadRecStates, applyStates } from "@/server/analytics/recommendation-states";
import { getAdAccountInWorkspace } from "@/server/tenancy/access";
import type { Recommendation } from "@/lib/metrics/recommendations";

afterAll(async () => closeDb());

const rec = (key: string): Recommendation => ({ key, rule: "funnel_ctr", category: "funil", priority: "alta", nature: "hipotese", title: "t", entity: { type: "funnel", name: "f" }, evidence: "e", action: "a", weight: 1, analysis: { reasoning: [], metrics: [], thresholds: [], comparison: null, limitations: [] } });

describe("status das recomendações", () => {
  it("fica isolado por workspace e 'lembrar depois' expira", async () => {
    await setupDb();
    const db = getDb();
    const u1 = await createUser("Bia");
    const u2 = await createUser("Caio");
    const wsA = await createWorkspaceWith(u1);
    const wsB = await createWorkspaceWith(u2);
    const [accA] = await db.insert(schema.adAccounts).values({ workspaceId: wsA, provider: "meta", externalId: "act_1", name: "A", currency: "BRL", timezoneName: "America/Sao_Paulo", isSelected: true }).returning();
    await db.insert(schema.recommendationStates).values([
      { workspaceId: wsA, adAccountId: accA.id, recKey: "funnel_ctr:account", status: "dismissed" },
      { workspaceId: wsA, adAccountId: accA.id, recKey: "creative_volume:account", status: "snoozed", snoozedUntil: new Date(Date.now() - 1000) },
    ]);
    const a = applyStates([rec("funnel_ctr:account"), rec("creative_volume:account"), rec("target_roas:account")], await loadRecStates(wsA, accA.id));
    expect(a.map((x) => x.status)).toEqual(["dismissed", "new", "new"]);
    // Outro workspace não enxerga (nem consegue resolver) a conta nem os status.
    expect((await loadRecStates(wsB, accA.id)).size).toBe(0);
    expect(await getAdAccountInWorkspace(wsB, accA.id)).toBeFalsy();
  });
});
