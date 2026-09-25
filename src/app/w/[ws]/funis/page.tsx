import Link from "next/link";
import { MagnifyingGlass } from "@phosphor-icons/react/ssr";
import { loadPage } from "@/server/page-context";
import { getFunnels } from "@/server/analytics/dashboard";
import { PageHeader } from "@/components/dashboard/page-header";
import { NoAccountState, FirstSyncState } from "@/components/dashboard/empty-states";
import { FunnelFlow, FunnelCaveat } from "@/components/dashboard/funnel-flow";
import { FunnelEditor } from "@/components/dashboard/funnel-editor";
import { Card } from "@/components/ui/card";
import { filtersToQuery } from "@/lib/filters";
import { fmtCurrency, fmtPct } from "@/lib/format";
import type { FunnelMetric } from "@/lib/metrics/analysis";
import { cn } from "@/lib/cn";

export const metadata = { title: "Funis" };
type SP = Record<string, string | string[] | undefined>;

export default async function FunnelsPage({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<SP> }) {
  const { ws } = await params;
  const sp = await searchParams;
  const data = await loadPage(ws, sp);
  const { ctx, acc, account, filters, freshness } = data;
  if (!acc || !account || !freshness)
    return (
      <>
        <PageHeader data={data} title="Funis" showFilters={false} />
        <NoAccountState ctx={ctx} />
      </>
    );
  if (!freshness.initialDone && !ctx.isDemo)
    return (
      <>
        <PageHeader data={data} title="Funis" showFilters={false} />
        <FirstSyncState ws={ws} accountId={acc.id} name={acc.name} />
      </>
    );
  const fn = await getFunnels(ctx, acc, filters);
  const canEdit = ctx.role !== "viewer";
  const cname = new Map(fn.campaigns.map((c) => [c.id, c.name]));
  const qs = filtersToQuery(filters);
  const wanted = Array.isArray(sp.funil) ? sp.funil[0] : sp.funil;
  const f = fn.funnels.find((x) => x.id === wanted) ?? fn.funnels[0];
  const tabHref = (id: string) => {
    const p = new URLSearchParams(qs.replace(/^\?/, ""));
    p.set("funil", id);
    return `/w/${ws}/funis?${p}`;
  };
  const newBtn = canEdit ? <FunnelEditor trigger="new" ws={ws} adAccountId={acc.id} tracking={fn.tracking} campaigns={fn.campaigns} adSets={fn.adSets} /> : null;

  const bottleneck = f?.result.stages.find((s) => s.isBottleneck);
  const before = bottleneck && f ? [...f.result.stages.slice(0, f.result.stages.indexOf(bottleneck))].reverse().find((s) => s.value.ok) : undefined;

  return (
    <>
      <PageHeader data={data} title="Funis" />
      <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 py-6 sm:px-8 sm:py-8">
        {fn.funnels.length === 0 ? (
          <Card className="flex flex-col items-start gap-3 px-6 py-10">
            <p className="text-[16px] font-semibold text-ink">Nenhum funil configurado</p>
            <p className="max-w-[56ch] text-[13.5px] text-ink-2">Escolha um modelo (e-commerce, cadastros ou mensagens) e as campanhas que fazem parte dele.</p>
            {newBtn}
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <nav aria-label="Funis" className="flex max-w-full gap-0.5 overflow-x-auto rounded-[12px] border border-line bg-surface-2 p-0.5 scrollbar-thin">
                {fn.funnels.map((x) => (
                  <Link key={x.id} scroll={false} href={tabHref(x.id)} aria-current={x.id === f!.id ? "page" : undefined} className={cn("whitespace-nowrap rounded-[10px] px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:text-ink", x.id === f!.id && "bg-surface text-ink shadow-card")}>
                    {x.name}
                  </Link>
                ))}
              </nav>
              {newBtn}
            </div>

            {f ? (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <section className="reveal rounded-[20px] border border-line bg-surface p-5 shadow-card sm:p-6">
                  <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="flex items-center gap-1.5 text-[16px] font-semibold tracking-[-0.01em] text-ink">
                        {f.name}
                        <FunnelCaveat warnings={f.result.warnings} />
                      </h2>
                      <p className="mt-0.5 truncate text-[12.5px] text-ink-3">
                        {f.adSetIds.length ? `${f.adSetIds.length} conjuntos` : f.campaignIds.length ? `${f.campaignIds.length} ${f.campaignIds.length === 1 ? "campanha" : "campanhas"}: ${f.campaignIds.slice(0, 2).map((c) => cname.get(c)).join(", ")}${f.campaignIds.length > 2 ? "…" : ""}` : "Todas as campanhas"}
                      </p>
                    </div>
                    {canEdit ? (
                      <FunnelEditor
                        trigger="edit"
                        ws={ws}
                        adAccountId={acc.id}
                        tracking={fn.tracking}
                        campaigns={fn.campaigns}
                        adSets={fn.adSets}
                        initial={{ id: f.id, name: f.name, kind: f.kind as "ecommerce", stages: f.stages as Array<{ key: string; label: string; metric: FunnelMetric }>, campaignIds: f.campaignIds, adSetIds: f.adSetIds }}
                      />
                    ) : null}
                  </div>
                  <FunnelFlow result={f.result} currency={account.currency} showCost />
                </section>

                <aside className="reveal flex flex-col gap-4" style={{ ["--i" as string]: 1 }}>
                  <div className={cn("rounded-[20px] border p-5 sm:p-6", bottleneck ? "border-serious/30 bg-serious-soft" : "border-line bg-surface")}>
                    <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-serious">
                      <MagnifyingGlass size={14} weight="bold" /> Onde investigar
                    </p>
                    {bottleneck && bottleneck.rateFromPrev?.ok ? (
                      <>
                        <p className="mt-2 text-[20px] font-semibold tracking-[-0.02em] text-ink">
                          {before ? `${before.label} → ` : ""}
                          {bottleneck.label}
                        </p>
                        <p className="mt-1 text-[13.5px] text-ink-2">
                          Só <strong className="font-semibold text-ink tnum">{fmtPct(bottleneck.rateFromPrev.value)}</strong> seguem para esta etapa: a maior perda depois do clique.
                        </p>
                      </>
                    ) : (
                      <p className="mt-2 text-[13.5px] text-ink-2">Sem etapas suficientes com dados para apontar um gargalo.</p>
                    )}
                  </div>
                  <div className="rounded-[20px] border border-line bg-surface p-5 sm:p-6">
                    <p className="text-[12.5px] text-ink-3">Investimento no funil</p>
                    <p className="mt-1 text-[26px] font-semibold tracking-[-0.03em] text-ink tnum">{fmtCurrency(f.spend, account.currency)}</p>
                    <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">Taxas entre etapas são de eventos agregados, não das mesmas pessoas. Use como ponto de investigação.</p>
                  </div>
                </aside>
              </div>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}
