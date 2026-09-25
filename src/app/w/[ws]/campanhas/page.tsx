import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react/ssr";
import { loadPage } from "@/server/page-context";
import { getExplorer } from "@/server/analytics/dashboard";
import { listCampaignMeta } from "@/server/analytics/queries";
import { PageHeader } from "@/components/dashboard/page-header";
import { NoAccountState, FirstSyncState } from "@/components/dashboard/empty-states";
import { ExplorerTable } from "@/components/dashboard/explorer-table";
import { Card } from "@/components/ui/card";
import { deriveKpis } from "@/lib/metrics/core";
import { filtersToQuery } from "@/lib/filters";
import { isUuid } from "@/server/tenancy/access";
import { fmtCurrency, fmtMetric } from "@/lib/format";

export const metadata = { title: "Campanhas" };
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CampaignsPage({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<SP> }) {
  const { ws } = await params;
  const sp = await searchParams;
  const data = await loadPage(ws, sp);
  const { ctx, acc, account, filters, freshness } = data;
  if (!acc || !account || !freshness)
    return (
      <>
        <PageHeader data={data} title="Campanhas" showFilters={false} />
        <NoAccountState ctx={ctx} />
      </>
    );
  if (!freshness.initialDone && !ctx.isDemo)
    return (
      <>
        <PageHeader data={data} title="Campanhas" showFilters={false} />
        <FirstSyncState ws={ws} accountId={acc.id} name={acc.name} />
      </>
    );

  const c = one(sp.c);
  const cj = one(sp.cj);
  const level = { campaignId: isUuid(c) ? c : undefined, adSetId: isUuid(c) && isUuid(cj) ? cj : undefined };
  const [ex, meta] = await Promise.all([getExplorer(ctx, acc, filters, level), listCampaignMeta({ workspaceId: ctx.workspaceId, adAccountId: acc.id })]);
  const qs = filtersToQuery(filters);
  const lvl = level.adSetId ? "ad" : level.campaignId ? "adset" : "campaign";
  const exportQs = new URLSearchParams(qs.replace(/^\?/, ""));
  if (level.campaignId) exportQs.set("c", level.campaignId);
  if (level.adSetId) exportQs.set("cj", level.adSetId);
  const totalK = ex.notFound ? null : deriveKpis(ex.total, ex.tracking);

  return (
    <>
      <PageHeader data={data} title="Campanhas" description="Campanha, conjunto e anúncio, com as mesmas definições de métricas da visão geral." campaigns={meta.map((m) => ({ id: m.id, name: m.name, group: m.group }))} />
      <main className="flex flex-col gap-4 px-4 py-6 sm:px-8">
        <nav aria-label="Nível" className="flex flex-wrap items-center gap-1 text-[13.5px]">
          <Link href={`/w/${ws}/campanhas${qs}`} className={lvl === "campaign" ? "font-semibold text-ink" : "text-accent-text hover:underline"}>
            Todas as campanhas
          </Link>
          {ex.breadcrumb.map((b, i) => (
            <span key={b.id} className="inline-flex items-center gap-1">
              <CaretRight size={12} className="text-ink-3" />
              {i === ex.breadcrumb.length - 1 ? (
                <span className="font-semibold text-ink">{b.name}</span>
              ) : (
                <Link href={`/w/${ws}/campanhas${qs ? `${qs}&` : "?"}c=${b.id}`} className="text-accent-text hover:underline">
                  {b.name}
                </Link>
              )}
            </span>
          ))}
        </nav>
        {ex.notFound ? (
          <Card className="p-8 text-center text-[14px] text-ink-2">Este item não existe nesta conta de anúncios ou você não tem acesso a ele.</Card>
        ) : (
          <>
            {totalK ? (
              <p className="text-[13px] text-ink-3">
                Total do nível: investimento <span className="font-medium text-ink-2">{fmtCurrency(ex.total.spend, account.currency)}</span> · ROAS <span className="font-medium text-ink-2">{fmtMetric(totalK.roas, "roas", account.currency)}</span> (calculado sobre os totais, não pela média das linhas).
              </p>
            ) : null}
            <Card className="overflow-hidden">
              <ExplorerTable rows={ex.rows} currency={account.currency} level={lvl} ws={ws} qs={qs} exportHref={`/api/w/${ws}/export?${exportQs}`} />
            </Card>
            <p className="text-[12.5px] text-ink-3">A variação abaixo de cada número compara com o período anterior de mesma duração. “Resultados” segue o objetivo de cada campanha (compras, leads, conversas, cliques ou impressões).</p>
          </>
        )}
      </main>
    </>
  );
}
