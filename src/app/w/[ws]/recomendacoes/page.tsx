import { loadPage } from "@/server/page-context";
import { getOverview } from "@/server/analytics/dashboard";
import { listCampaignMeta } from "@/server/analytics/queries";
import { loadRecStates, applyStates } from "@/server/analytics/recommendation-states";
import { PageHeader } from "@/components/dashboard/page-header";
import { NoAccountState, FirstSyncState } from "@/components/dashboard/empty-states";
import { AllRecs } from "@/components/dashboard/recommendations/rec-list";
import { Hint } from "@/components/ui/hint";
import { filtersToQuery } from "@/lib/filters";
import { fmtRange } from "@/lib/format";

export const metadata = { title: "Recomendações" };
type SP = Record<string, string | string[] | undefined>;

export default async function RecommendationsPage({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<SP> }) {
  const { ws } = await params;
  const sp = await searchParams;
  const data = await loadPage(ws, sp);
  const { ctx, acc, account, filters, freshness } = data;
  if (!acc || !account || !freshness) {
    return (
      <>
        <PageHeader data={data} title="Recomendações" showFilters={false} />
        <NoAccountState ctx={ctx} />
      </>
    );
  }
  if (!freshness.initialDone && !ctx.isDemo) {
    return (
      <>
        <PageHeader data={data} title="Recomendações" showFilters={false} />
        <FirstSyncState ws={ws} accountId={acc.id} name={acc.name} />
      </>
    );
  }
  const [ov, meta, states] = await Promise.all([getOverview(ctx, acc, filters), listCampaignMeta({ workspaceId: ctx.workspaceId, adAccountId: acc.id }), loadRecStates(ctx.workspaceId, acc.id)]);
  const r = ov.recommendations;
  const items = applyStates(r.items, states);
  const qs = filtersToQuery(filters);
  const generated = new Date(r.generatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  return (
    <>
      <PageHeader data={data} title="Recomendações" description={`${r.period.label} · comparado a ${fmtRange(r.comparison.from, r.comparison.to)}`} campaigns={meta.map((c) => ({ id: c.id, name: c.name, group: c.group }))} />
      <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
          <span>Geradas em {generated} para este período e estes filtros.</span>
          <Hint label="Como funcionam">
            <p>Regras explícitas do Growth OS: funil analisado de baixo para cima (compra, checkout, página, clique), tendência de custo por venda, escala com base nas suas metas, desgaste e volume de criativos.</p>
            <p className="mt-1.5">Cada regra exige volume mínimo. “Hipótese” indica causa provável, não comprovada. Nada é alterado na Meta.</p>
          </Hint>
        </div>
        {r.caveats.length ? (
          <ul className="flex flex-col gap-1 text-[12.5px] text-warn">
            {r.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : null}

        <AllRecs items={items} ws={ws} accountId={acc.id} qs={qs} canEdit={ctx.role !== "viewer"} periodLabel={r.period.label} comparisonLabel={r.comparison.label} generatedAt={r.generatedAt} />

        {r.skipped.length ? (
          <details className="disclosure group rounded-[16px] border border-line bg-surface">
            <summary className="cursor-pointer px-5 py-3.5 text-[13.5px] font-medium text-ink-2 hover:text-ink">Dados insuficientes para {r.skipped.length} {r.skipped.length === 1 ? "análise" : "análises"}</summary>
            <ul className="flex flex-col gap-1.5 border-t border-line px-5 py-4 text-[13px] text-ink-2">
              {r.skipped.map((s) => (
                <li key={s.rule + s.reason}>
                  <span className="font-medium text-ink">{s.rule}:</span> {s.reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </main>
    </>
  );
}
