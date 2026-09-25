import Link from "next/link";
import { Trophy, ArrowRight } from "@phosphor-icons/react/ssr";
import { loadPage } from "@/server/page-context";
import { getOverview } from "@/server/analytics/dashboard";
import { listCampaignMeta } from "@/server/analytics/queries";
import { PageHeader } from "@/components/dashboard/page-header";
import { NoAccountState, FirstSyncState, EmptyPeriodState } from "@/components/dashboard/empty-states";
import { KpiCard, kpiFormat, pickKpi, type KpiSpec } from "@/components/dashboard/kpi";
import { Card, CardHeader } from "@/components/ui/card";
import { SpendRevenueChart, RoasChart, ResultsChart } from "@/components/charts/trend-charts";
import { CampaignContribution, InsightList, AdCard, FunnelView, Placements } from "@/components/dashboard/sections";
import { MetricText } from "@/components/dashboard/metric-value";
import { METRICS } from "@/lib/metrics/definitions";
import { RESULT_LABEL, type RankBy, type ResultKind } from "@/lib/metrics/analysis";
import { filtersToQuery } from "@/lib/filters";
import { fmtCurrency, fmtNumber, fmtRange } from "@/lib/format";
import type { KpiKey } from "@/lib/metrics/core";
import { NON_ADDITIVE_NOTE } from "@/lib/metrics/definitions";
import { cn } from "@/lib/cn";

export const metadata = { title: "Visão geral" };

type SP = Record<string, string | string[] | undefined>;

const PRIMARY: Record<ResultKind, KpiSpec["key"][]> = {
  purchases: ["roas", "purchases", "purchaseValue", "spend"],
  leads: ["leads", "costPerLead", "spend", "ctr"],
  messaging: ["messagingConversations", "costPerConversation", "spend", "ctr"],
  linkClicks: ["linkClicks", "cpc", "spend", "ctr"],
  impressions: ["reach", "impressions", "frequency", "cpm"],
};
const SECONDARY: Record<ResultKind, KpiSpec["key"][]> = {
  purchases: ["costPerPurchase", "averageOrderValue", "ctr", "cpc", "cpm", "reach"],
  leads: ["linkClicks", "cpc", "cpm", "landingPageViews", "impressions", "reach"],
  messaging: ["linkClicks", "cpc", "cpm", "impressions", "reach", "frequency"],
  linkClicks: ["landingPageViews", "cpm", "impressions", "reach", "frequency", "purchases"],
  impressions: ["spend", "linkClicks", "ctr", "cpc", "landingPageViews", "purchases"],
};

const RANK_OPTIONS: Array<{ id: RankBy; label: string; salesOnly?: boolean }> = [
  { id: "roas", label: "ROAS", salesOnly: true },
  { id: "purchases", label: "Compras", salesOnly: true },
  { id: "purchaseValue", label: "Receita", salesOnly: true },
  { id: "costPerPurchase", label: "Custo por compra", salesOnly: true },
  { id: "results", label: "Resultados" },
  { id: "costPerResult", label: "Custo por resultado" },
];

export default async function OverviewPage({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<SP> }) {
  const { ws } = await params;
  const sp = await searchParams;
  const data = await loadPage(ws, sp);
  const { ctx, acc, account, filters, freshness } = data;

  if (!acc || !account || !freshness) {
    return (
      <>
        <PageHeader data={data} title="Visão geral" showFilters={false} />
        <NoAccountState ctx={ctx} />
      </>
    );
  }
  if (!freshness.initialDone && !ctx.isDemo) {
    return (
      <>
        <PageHeader data={data} title="Visão geral" showFilters={false} />
        <FirstSyncState ws={ws} accountId={acc.id} name={acc.name} />
      </>
    );
  }

  const rankParam = (Array.isArray(sp.ranking) ? sp.ranking[0] : sp.ranking) as RankBy | undefined;
  const rankBy: RankBy = RANK_OPTIONS.some((o) => o.id === rankParam) ? rankParam! : "roas";
  const [ov, campaignMeta] = await Promise.all([getOverview(ctx, acc, filters, rankBy), listCampaignMeta({ workspaceId: ctx.workspaceId, adAccountId: acc.id })]);
  const campaigns = campaignMeta.map((c) => ({ id: c.id, name: c.name, group: c.group }));
  const qs = filtersToQuery(filters);
  const cur = account.currency;
  const kind = ov.kind;
  const salesKind = kind === "purchases";
  const resultLabel = RESULT_LABEL[kind];

  if (!ov.hasAnyData) {
    return (
      <>
        <PageHeader data={data} title="Visão geral" campaigns={campaigns} />
        <EmptyPeriodState ws={ws} qsWithout={filtersToQuery({ account: filters.account, preset: "30d" })} />
      </>
    );
  }

  const spark = (key: KpiSpec["key"]): Array<number | null> | undefined => {
    switch (key) {
      case "spend":
        return ov.series.map((p) => p.spend);
      case "purchaseValue":
        return ov.series.map((p) => p.revenue);
      case "purchases":
        return ov.series.map((p) => p.purchases);
      case "roas":
        return ov.series.map((p) => p.roas);
      case "leads":
      case "messagingConversations":
      case "linkClicks":
        return ov.series.map((p) => p.results);
      default:
        return undefined;
    }
  };
  const infoFor = (key: KpiSpec["key"]) => (key in METRICS ? METRICS[key as KpiKey] : key === "reach" || key === "frequency" ? { formula: key === "reach" ? "Pessoas únicas alcançadas no intervalo exato" : "Impressões ÷ alcance no intervalo exato", source: "Meta Insights · reach/frequency (consulta do intervalo, sem somar dias)", aggregation: NON_ADDITIVE_NOTE } : undefined);
  const label = (key: KpiSpec["key"]) => (key === "reach" ? "Alcance" : key === "frequency" ? "Frequência" : METRICS[key as KpiKey].label);

  const primary = PRIMARY[kind];
  const secondary = SECONDARY[kind].filter((k) => !primary.includes(k));
  const insufficient = ov.ranking.insufficientCount;
  const th = ov.ranking.thresholds;

  return (
    <>
      <PageHeader data={data} title="Visão geral" description={`Desempenho de ${fmtRange(filters.from, filters.to)} comparado a ${fmtRange(filters.prevFrom, filters.prevTo)} (mesmo número de dias).`} campaigns={campaigns} />
      <main className="flex flex-col gap-5 px-4 py-6 sm:px-8">
        {kind === "messaging" ? (
          <p className="rounded-[12px] border border-line bg-info-soft px-4 py-3 text-[13.5px] text-ink">Conversas iniciadas no WhatsApp, Messenger ou Direct não são vendas confirmadas. Para medir vendas desse canal, é preciso uma fonte de vendas (CRM ou checkout) conectada.</p>
        ) : null}

        {/* 1) KPIs principais - ROAS, compras, receita e investimento */}
        <section aria-label="Indicadores principais" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {primary.map((key, i) => (
            <KpiCard
              key={key}
              hero={i === 0}
              spec={{ key, label: label(key), spark: spark(key) }}
              current={pickKpi(ov.kpis, key, ov.reach.current)}
              previous={pickKpi(ov.prevKpis, key, ov.reach.previous)}
              currency={cur}
              format={kpiFormat(key)}
              info={infoFor(key)}
            />
          ))}
        </section>

        <section aria-label="Indicadores de apoio" className="grid grid-cols-2 overflow-hidden rounded-[14px] border border-line bg-line shadow-card sm:grid-cols-3 xl:grid-cols-6" style={{ gap: 1 }}>
          {secondary.slice(0, 6).map((key) => {
            const m = pickKpi(ov.kpis, key, ov.reach.current);
            return (
              <div key={key} className="bg-surface px-4 py-3.5">
                <p className="text-[12.5px] text-ink-3">{label(key)}</p>
                <p className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-ink tnum">
                  <MetricText m={m} format={kpiFormat(key)} currency={cur} />
                </p>
              </div>
            );
          })}
        </section>

        {/* 2) Visão acionável: tendência + alertas */}
        <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title={ov.tracking.purchase ? "Investimento e receita atribuída" : "Investimento diário"} description={`Valores diários em ${cur}, no fuso da conta.`} />
            <div className="px-3 pb-4 pt-4 sm:px-5">
              <SpendRevenueChart data={ov.series} currency={cur} revenueTracked={ov.tracking.purchase} />
            </div>
          </Card>
          <Card className="flex flex-col">
            <CardHeader title="Alertas e oportunidades" description="Regras explícitas, sem inferir causa." />
            <div className="mt-2 flex-1">
              <InsightList items={ov.insights} stale={freshness.stale && freshness.staleReason ? { message: freshness.staleReason } : null} />
            </div>
            <div className="border-t border-line px-5 py-3 text-[12.5px] text-ink-3">
              Metas: ROAS {ctx.settings.roasTarget ? fmtNumber(ctx.settings.roasTarget, 2) + "×" : "não definida"} · CPA {ctx.settings.cpaTarget ? fmtCurrency(ctx.settings.cpaTarget, cur) : "não definido"}.{" "}
              {ctx.role !== "viewer" ? (
                <Link href={`/w/${ws}/configuracoes`} className="font-medium text-accent-text hover:underline">
                  Ajustar
                </Link>
              ) : null}
            </div>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {ov.tracking.purchase ? (
            <Card>
              <CardHeader title="ROAS ao longo do tempo" description="Receita atribuída ÷ investimento, por dia. Escala própria (×), separada dos valores em moeda." />
              <div className="px-3 pb-4 pt-4 sm:px-5">
                <RoasChart data={ov.series} target={ctx.settings.roasTarget} />
              </div>
            </Card>
          ) : null}
          <Card className={cn(!ov.tracking.purchase && "xl:col-span-2")}>
            <CardHeader title={`${resultLabel.plural[0].toUpperCase()}${resultLabel.plural.slice(1)} por dia`} description={`Total no período: ${fmtNumber(kind === "purchases" ? ov.current.purchases : kind === "leads" ? ov.current.leads : kind === "messaging" ? ov.current.messagingConversations : kind === "linkClicks" ? ov.current.linkClicks : ov.current.impressions)}.`} />
            <div className="px-3 pb-4 pt-4 sm:px-5">
              <ResultsChart data={ov.series} label={resultLabel.plural[0].toUpperCase() + resultLabel.plural.slice(1)} currency={cur} costLabel={resultLabel.cost} />
            </div>
          </Card>
        </section>

        {/* 3) Contribuição e funil */}
        <section className="grid grid-cols-1 gap-5 xl:grid-cols-5">
          <Card className="xl:col-span-2">
            <CardHeader
              title="Contribuição por campanha"
              description={ov.tracking.purchase ? "Quanto cada campanha consome do investimento e quanto traz da receita atribuída." : "Participação de cada campanha no investimento."}
              action={
                <Link href={`/w/${ws}/campanhas${qs}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-text hover:underline">
                  Explorar <ArrowRight size={14} />
                </Link>
              }
            />
            <div className="px-5 pb-5 pt-5">
              <CampaignContribution rows={ov.campaigns} currency={cur} revenueTracked={ov.tracking.purchase} ws={ws} qs={qs} />
            </div>
          </Card>
          <Card className="xl:col-span-3">
            <CardHeader
              title={`Funil agregado · ${ov.funnel.name}`}
              description="Contagens agregadas de eventos da Meta, não uma jornada verificada das mesmas pessoas. Use como indicador de onde investigar."
              action={
                <Link href={`/w/${ws}/funis${qs}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-text hover:underline">
                  Configurar funis <ArrowRight size={14} />
                </Link>
              }
            />
            <div className="px-5 pb-5 pt-3">
              <FunnelView result={ov.funnel} currency={cur} />
            </div>
          </Card>
        </section>

        {/* 4) Melhores anúncios */}
        <Card>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <Trophy size={18} weight="fill" className="text-accent-text" /> Melhores anúncios
              </span>
            }
            description={`Somente anúncios com investimento ≥ ${fmtCurrency(th.minSpend, cur)} e ≥ ${fmtNumber(th.minResults)} ${resultLabel.plural}. ${insufficient ? `${insufficient} anúncios com gasto ficaram de fora por dados insuficientes.` : ""} Ranking descritivo, sem teste de significância estatística.`}
            action={
              <nav aria-label="Ordenar ranking" className="flex flex-wrap gap-1 rounded-[10px] border border-line bg-surface-2 p-0.5">
                {RANK_OPTIONS.filter((o) => (salesKind ? o.salesOnly : !o.salesOnly)).map((o) => {
                  const q = new URLSearchParams(qs.replace(/^\?/, ""));
                  q.set("ranking", o.id);
                  const active = ov.ranking.rankBy === o.id;
                  return (
                    <Link key={o.id} scroll={false} href={`/w/${ws}/visao-geral?${q}`} aria-current={active ? "true" : undefined} className={cn("rounded-[8px] px-2.5 py-1 text-[12.5px] font-medium text-ink-2 transition-colors hover:text-ink", active && "bg-surface text-ink shadow-card")}>
                      {o.label}
                    </Link>
                  );
                })}
              </nav>
            }
          />
          <div className="p-5">
            {ov.ranking.top.length ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {ov.ranking.top.slice(0, 4).map((a, i) => (
                  <AdCard key={a.id} ad={a} kind={kind} currency={cur} rank={i + 1} />
                ))}
              </div>
            ) : (
              <p className="text-[13.5px] text-ink-3">Nenhum anúncio atingiu os limiares mínimos no período. Amplie o período ou ajuste os limiares em Configurações.</p>
            )}
            <div className="mt-4">
              <Link href={`/w/${ws}/criativos${qs}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-text hover:underline">
                Ver todos os criativos <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </Card>

        {/* 5) Posicionamentos + notas de atribuição */}
        <section className="grid grid-cols-1 gap-5 xl:grid-cols-5">
          <Card className="xl:col-span-3">
            <CardHeader title="Plataformas e posicionamentos" description="Onde o investimento foi entregue." />
            <div className="mt-3">
              <Placements rows={ov.placements} currency={cur} revenueTracked={ov.tracking.purchase} />
            </div>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader title="Como ler estes números" />
            <ul className="flex flex-col gap-2.5 px-5 pb-5 pt-3 text-[13px] leading-relaxed text-ink-2">
              <li>Compras e receita são <strong className="font-semibold text-ink">atribuídas pela Meta</strong> conforme a janela de cada conjunto. Podem diferir das vendas confirmadas no seu checkout ou CRM.</li>
              <li>ROAS mede receita atribuída por real investido. Não é lucro nem ROI: não considera custo do produto, frete, impostos ou devoluções.</li>
              <li>Vendas do seu sistema só podem ser ligadas a um anúncio com identificadores de atribuição (UTM, click ID). Integrações de checkout e CRM estão planejadas.</li>
              <li>Os últimos {process.env.SYNC_RECONCILIATION_DAYS ?? 7} dias são reprocessados a cada sincronização: conversões atrasadas podem mudar os números recentes.</li>
            </ul>
          </Card>
        </section>
      </main>
    </>
  );
}
