import { type NextRequest } from "next/server";
import { requireWorkspace, AccessError, resolveActiveAdAccount } from "@/server/tenancy/access";
import { parseFilters } from "@/lib/filters";
import { todayInTimezone } from "@/lib/metrics/core";
import { getExplorer } from "@/server/analytics/dashboard";
import { OBJECTIVE_LABEL } from "@/lib/metrics/actions";
import { isUuid } from "@/server/tenancy/access";

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Evita injeção de fórmulas em planilhas.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "" : v.toFixed(d).replace(".", ","));

/** Exportação CSV (padrão brasileiro: ; e vírgula decimal) - sempre restrita ao workspace. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ ws: string }> }) {
  try {
    const { ws } = await params;
    const ctx = await requireWorkspace(ws);
    const sp = Object.fromEntries(req.nextUrl.searchParams);
    const acc = await resolveActiveAdAccount(ctx, sp.conta ?? null);
    if (!acc) return new Response("Nenhuma conta conectada.", { status: 404 });
    const f = parseFilters(sp, todayInTimezone(acc.timezoneName));
    const level = { campaignId: isUuid(sp.c) ? sp.c : undefined, adSetId: isUuid(sp.cj) ? sp.cj : undefined };
    const data = await getExplorer(ctx, acc, f, level);
    const header = ["Nome", "Nível", "Objetivo", "Status", `Investimento (${acc.currency})`, "Impressões", "Cliques no link", "Compras", `Receita atribuída (${acc.currency})`, "ROAS", `Custo por compra (${acc.currency})`, "Leads", "Conversas", "CTR (%)", `CPM (${acc.currency})`];
    const lines = [header.map(csvCell).join(";")];
    for (const r of data.rows) {
      const k = r.kpis;
      lines.push(
        [
          r.name,
          r.level === "campaign" ? "Campanha" : r.level === "adset" ? "Conjunto" : "Anúncio",
          r.group ? OBJECTIVE_LABEL[r.group] : "",
          r.status ?? "",
          num(r.totals.spend),
          num(r.totals.impressions, 0),
          num(r.totals.linkClicks, 0),
          k.purchases.ok ? num(k.purchases.value, 0) : "",
          k.purchaseValue.ok ? num(k.purchaseValue.value) : "",
          k.roas.ok ? num(k.roas.value) : "",
          k.costPerPurchase.ok ? num(k.costPerPurchase.value) : "",
          k.leads.ok ? num(k.leads.value, 0) : "",
          k.messagingConversations.ok ? num(k.messagingConversations.value, 0) : "",
          k.ctr.ok ? num(k.ctr.value) : "",
          k.cpm.ok ? num(k.cpm.value) : "",
        ]
          .map(csvCell)
          .join(";"),
      );
    }
    const note = `# Conta ${acc.name} (${acc.externalId}) · período ${f.from} a ${f.to} · fuso ${acc.timezoneName} · atribuição: configuração de cada conjunto (unificada)${ctx.isDemo ? " · MODO DEMONSTRAÇÃO (dados fictícios)" : ""}`;
    const body = "﻿" + [note, ...lines].join("\r\n");
    return new Response(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="norte-${f.from}-${f.to}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AccessError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
