import Link from "next/link";
import { SquaresFour, Table } from "@phosphor-icons/react/ssr";
import { loadPage } from "@/server/page-context";
import { getCreatives } from "@/server/analytics/dashboard";
import { listCampaignMeta } from "@/server/analytics/queries";
import { PageHeader } from "@/components/dashboard/page-header";
import { NoAccountState, FirstSyncState } from "@/components/dashboard/empty-states";
import { Thumb } from "@/components/dashboard/sections";
import { CreativeTile } from "@/components/dashboard/ad-ranking";
import { Hint } from "@/components/ui/hint";
import { Card } from "@/components/ui/card";
import { RESULT_LABEL, type RankBy } from "@/lib/metrics/analysis";
import { filtersToQuery } from "@/lib/filters";
import { fmtCurrency, fmtNumber, fmtMetric } from "@/lib/format";
import { cn } from "@/lib/cn";
import { OBJECTIVE_LABEL } from "@/lib/metrics/actions";

export const metadata = { title: "Criativos" };
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const SALES: Array<[RankBy, string]> = [
  ["roas", "Maior ROAS"],
  ["purchases", "Mais vendas"],
  ["purchaseValue", "Mais receita"],
  ["costPerPurchase", "Menor custo"],
];
const OTHER: Array<[RankBy, string]> = [
  ["results", "Mais resultados"],
  ["costPerResult", "Menor custo"],
];

export default async function CreativesPage({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<SP> }) {
  const { ws } = await params;
  const sp = await searchParams;
  const data = await loadPage(ws, sp);
  const { ctx, acc, account, filters, freshness } = data;
  if (!acc || !account || !freshness)
    return (
      <>
        <PageHeader data={data} title="Criativos" showFilters={false} />
        <NoAccountState ctx={ctx} />
      </>
    );
  if (!freshness.initialDone && !ctx.isDemo)
    return (
      <>
        <PageHeader data={data} title="Criativos" showFilters={false} />
        <FirstSyncState ws={ws} accountId={acc.id} name={acc.name} />
      </>
    );
  const rankParam = one(sp.ranking) as RankBy | undefined;
  const view = one(sp.visao) === "tabela" ? "tabela" : "grade";
  const [cr, meta] = await Promise.all([getCreatives(ctx, acc, filters, rankParam ?? "roas"), listCampaignMeta({ workspaceId: ctx.workspaceId, adAccountId: acc.id })]);
  const qs = filtersToQuery(filters);
  const cur = account.currency;
  const label = RESULT_LABEL[cr.kind];
  const opts = cr.kind === "purchases" ? SALES : OTHER;
  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams(qs.replace(/^\?/, ""));
    p.set("ranking", cr.rankBy);
    p.set("visao", view);
    for (const [k, v] of Object.entries(patch)) p.set(k, v);
    return `/w/${ws}/criativos?${p}`;
  };

  return (
    <>
      <PageHeader data={data} title="Criativos" campaigns={meta.map((m) => ({ id: m.id, name: m.name, group: m.group }))} />
      <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Ordenar por" className="flex flex-wrap items-center gap-0.5 rounded-[12px] border border-line bg-surface-2 p-0.5">
            {opts.map(([id, l]) => (
              <Link key={id} scroll={false} href={link({ ranking: id })} aria-current={cr.rankBy === id ? "true" : undefined} className={cn("rounded-[8px] px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:text-ink", cr.rankBy === id && "bg-surface text-ink shadow-card")}>
                {l}
              </Link>
            ))}
          </nav>
          <Hint label="Critério do ranking">
            <p>
              Entram no ranking anúncios com investimento ≥ <strong className="font-medium text-ink">{fmtCurrency(cr.thresholds.minSpend, cur)}</strong> e ≥ <strong className="font-medium text-ink">{fmtNumber(cr.thresholds.minResults)} {label.plural}</strong>, para que amostras pequenas não virem destaque.
            </p>
            <p className="mt-1.5">“Volume”: entre os 25% com mais {label.plural}. “Eficiência”: pelo menos 20% melhor que a conta. Sem teste de significância estatística.</p>
            {cr.group !== "mixed" && !filters.objective ? <p className="mt-1.5">Mostrando anúncios de campanhas de {OBJECTIVE_LABEL[cr.group].toLowerCase()}; use o filtro de objetivo para ver os demais.</p> : null}
          </Hint>
          </div>
          <nav aria-label="Visualização" className="flex items-center gap-1 rounded-[10px] border border-line bg-surface-2 p-0.5">
            <Link scroll={false} href={link({ visao: "grade" })} aria-current={view === "grade" ? "true" : undefined} className={cn("inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[13px] font-medium text-ink-2", view === "grade" && "bg-surface text-ink shadow-card")}>
              <SquaresFour size={15} /> Grade
            </Link>
            <Link scroll={false} href={link({ visao: "tabela" })} aria-current={view === "tabela" ? "true" : undefined} className={cn("inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[13px] font-medium text-ink-2", view === "tabela" && "bg-surface text-ink shadow-card")}>
              <Table size={15} /> Tabela
            </Link>
          </nav>
        </div>


        {view === "grade" ? (
          cr.ranked.length ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {cr.ranked.map((a, i) => (
                <CreativeTile key={a.id} ad={a} kind={cr.kind} currency={cur} rank={i + 1} featured={i === 0} />
              ))}
            </div>
          ) : (
            <Card className="p-8 text-center text-[14px] text-ink-2">Dados insuficientes: nenhum anúncio atingiu o mínimo de investimento e resultados. Amplie o período ou ajuste os limiares em Configurações.</Card>
          )
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <caption className="sr-only">Anúncios elegíveis ordenados</caption>
              <thead>
                <tr className="bg-surface-2 text-left text-[12px] text-ink-3">
                  <th className="px-4 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Anúncio</th>
                  <th className="px-3 py-2.5 text-right font-medium">Investimento</th>
                  <th className="px-3 py-2.5 text-right font-medium">{label.plural[0].toUpperCase() + label.plural.slice(1)}</th>
                  {cr.kind === "purchases" ? <th className="px-3 py-2.5 text-right font-medium">Receita</th> : null}
                  {cr.kind === "purchases" ? <th className="px-3 py-2.5 text-right font-medium">ROAS</th> : null}
                  <th className="px-3 py-2.5 text-right font-medium">{label.cost}</th>
                  <th className="px-4 py-2.5 text-right font-medium">CTR (link)</th>
                </tr>
              </thead>
              <tbody>
                {cr.ranked.map((a, i) => (
                  <tr key={a.id} id={`anuncio-${a.id}`} className="border-t border-line target:bg-accent-soft">
                    <td className="px-4 py-2.5 text-ink-3 tnum">{i + 1}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Thumb url={a.creative?.thumbnailUrl} name={a.name} className="h-10 w-10 shrink-0 rounded-[8px]" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{a.name}</p>
                          <p className="truncate text-[12px] text-ink-3">{a.campaignName}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tnum">{fmtCurrency(a.totals.spend, cur)}</td>
                    <td className="px-3 py-2.5 text-right tnum">{fmtNumber(a.results)}</td>
                    {cr.kind === "purchases" ? <td className="px-3 py-2.5 text-right tnum">{fmtCurrency(a.totals.purchaseValue, cur)}</td> : null}
                    {cr.kind === "purchases" ? <td className="px-3 py-2.5 text-right font-medium tnum">{fmtMetric(a.kpis.roas, "roas", cur)}</td> : null}
                    <td className="px-3 py-2.5 text-right tnum">{fmtMetric(a.cpr, "currency", cur)}</td>
                    <td className="px-4 py-2.5 text-right tnum">{fmtMetric(a.kpis.ctr, "pct", cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {cr.insufficient.length ? (
          <details className="disclosure group rounded-[16px] border border-line bg-surface">
            <summary className="cursor-pointer px-5 py-3.5 text-[13.5px] font-medium text-ink-2 hover:text-ink">
              Dados insuficientes: {cr.insufficient.length} {cr.insufficient.length === 1 ? "anúncio fora" : "anúncios fora"} do ranking
            </summary>
            <ul className="divide-y divide-line border-t border-line">
              {cr.insufficient.slice(0, 12).map((a) => (
                <li key={a.id} id={`anuncio-${a.id}`} className="flex items-center gap-3 px-5 py-3 target:bg-accent-soft">
                  <Thumb url={a.creative?.thumbnailUrl} name={a.name} className="h-10 w-10 shrink-0 rounded-[8px]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink">{a.name}</p>
                    <p className="text-[12.5px] text-ink-3">{a.insufficientReason}</p>
                  </div>
                  <span className="text-[13px] text-ink-2 tnum">{fmtCurrency(a.totals.spend, cur)}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </main>
    </>
  );
}
