import { loadPage } from "@/server/page-context";
import { getFunnels } from "@/server/analytics/dashboard";
import { PageHeader } from "@/components/dashboard/page-header";
import { NoAccountState, FirstSyncState } from "@/components/dashboard/empty-states";
import { FunnelView } from "@/components/dashboard/sections";
import { FunnelEditor } from "@/components/dashboard/funnel-editor";
import { Card, CardHeader } from "@/components/ui/card";
import { fmtCurrency } from "@/lib/format";
import type { FunnelMetric } from "@/lib/metrics/analysis";

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
  return (
    <>
      <PageHeader data={data} title="Funis" description="Funis de negócio montados a partir de eventos agregados da Meta. Conta e período vêm dos filtros; as campanhas vêm do mapeamento de cada funil." />
      <main className="flex flex-col gap-5 px-4 py-6 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-[14px] border border-line bg-info-soft px-5 py-4">
          <p className="max-w-[80ch] text-[13.5px] leading-relaxed text-ink">
            <strong className="font-semibold">Funil agregado de eventos (proxy).</strong> Cada etapa soma eventos contados pela Meta no período. Não são necessariamente as mesmas pessoas avançando em ordem, então as taxas indicam onde investigar, não uma conversão verificada por usuário. Taxas acima de 100% são mostradas como estão. Funis sequenciais reais exigem uma fonte de analytics com coorte de usuários (planejado).
          </p>
          {canEdit ? <FunnelEditor trigger="new" ws={ws} adAccountId={acc.id} tracking={fn.tracking} campaigns={fn.campaigns} adSets={fn.adSets} /> : null}
        </div>
        {fn.funnels.length === 0 ? (
          <Card className="px-6 py-12 text-center">
            <p className="text-[15px] font-semibold text-ink">Nenhum funil configurado</p>
            <p className="mx-auto mt-1 max-w-[52ch] text-[13.5px] text-ink-2">Não dá para descobrir sozinho qual funil representa o seu negócio. Crie um a partir de um modelo e escolha as campanhas que fazem parte dele.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
            {fn.funnels.map((f) => (
              <Card key={f.id}>
                <CardHeader
                  title={f.name}
                  description={`${f.adSetIds.length ? `${f.adSetIds.length} conjuntos mapeados` : f.campaignIds.length ? `${f.campaignIds.length} campanhas: ${f.campaignIds.slice(0, 3).map((c) => cname.get(c)).join(", ")}${f.campaignIds.length > 3 ? "…" : ""}` : "Todas as campanhas da conta"} · investimento ${fmtCurrency(f.spend, account.currency)}`}
                  action={
                    canEdit ? (
                      <FunnelEditor
                        trigger="edit"
                        ws={ws}
                        adAccountId={acc.id}
                        tracking={fn.tracking}
                        campaigns={fn.campaigns}
                        adSets={fn.adSets}
                        initial={{ id: f.id, name: f.name, kind: f.kind as "ecommerce", stages: f.stages as Array<{ key: string; label: string; metric: FunnelMetric }>, campaignIds: f.campaignIds, adSetIds: f.adSetIds }}
                      />
                    ) : null
                  }
                />
                <div className="px-5 pb-5 pt-2">
                  <FunnelView result={f.result} currency={account.currency} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
