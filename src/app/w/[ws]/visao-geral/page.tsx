import Link from "next/link";
import { ArrowRight, CaretDown } from "@phosphor-icons/react/ssr";
import { loadPage } from "@/server/page-context";
import { getOverview } from "@/server/analytics/dashboard";
import { listCampaignMeta } from "@/server/analytics/queries";
import { loadRecStates, applyStates } from "@/server/analytics/recommendation-states";
import { PageHeader } from "@/components/dashboard/page-header";
import { NoAccountState, FirstSyncState, EmptyPeriodState } from "@/components/dashboard/empty-states";
import { HeroSummary, KpiTiles, labelFor, formatFor, PLAIN } from "@/components/dashboard/overview/hero";
import { TrendTabs } from "@/components/dashboard/overview/trend-tabs";
import { OpenRecs } from "@/components/dashboard/recommendations/rec-list";
import { FunnelFlow, FunnelCaveat } from "@/components/dashboard/funnel-flow";
import { AdRankList } from "@/components/dashboard/ad-ranking";
import { CampaignContribution, Placements } from "@/components/dashboard/sections";
import { MetricText } from "@/components/dashboard/metric-value";
import { Hint } from "@/components/ui/hint";
import { pickKpi } from "@/components/dashboard/kpi";
import { RESULT_LABEL, type RankBy, type ResultKind } from "@/lib/metrics/analysis";
import { daysBetweenInclusive, type KpiKey } from "@/lib/metrics/core";
import { filtersToQuery } from "@/lib/filters";
import { fmtCurrency, fmtNumber, fmtRange } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Visão geral" };

type SP = Record<string, string | string[] | undefined>;

const TILES: Record<ResultKind, KpiKey[]> = {
  purchases: ["purchases", "purchaseValue", "spend", "costPerPurchase"],
  leads: ["costPerLead", "spend", "ctr", "cpc"],
  messaging: ["costPerConversation", "spend", "ctr", "cpc"],
  linkClicks: ["cpc", "spend", "ctr", "cpm"],
  impressions: ["cpm", "spend", "ctr", "linkClicks"],
};
const MORE: Record<ResultKind, Array<KpiKey | "reach" | "frequency">> = {
  purchases: ["averageOrderValue", "ctr", "cpc", "cpm", "reach", "frequency"],
  leads: ["leads", "linkClicks", "landingPageViews", "cpm", "reach", "frequency"],
  messaging: ["messagingConversations", "linkClicks", "cpm", "impressions", "reach", "frequency"],
  linkClicks: ["linkClicks", "landingPageViews", "impressions", "reach", "frequency", "purchases"],
  impressions: ["impressions", "reach", "frequency", "cpc", "landingPageViews", "purchases"],
};

const RANK_OPTIONS: Array<{ id: RankBy; label: string; salesOnly?: boolean; hint: string }> = [
  { id: "roas", label: "Mais eficientes", salesOnly: true, hint: "Maior ROAS" },
  { id: "purchases", label: "Mais vendas", salesOnly: true, hint: "Mais vendas atribuídas" },
  { id: "costPerResult", label: "Mais eficientes", hint: "Menor custo por resultado" },
  { id: "results", label: "Mais resultados", hint: "Mais resultados" },
];

function Section({ title, hint, action, children, className, i = 0 }: { title: string; hint?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; i?: number }) {
  return (
    <section className={cn("reveal flex min-w-0 flex-col rounded-[20px] border border-line bg-surface p-5 shadow-card sm:p-6", className)} style={{ ["--i" as string]: i }}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-[-0.01em] text-ink">
          {title}
          {hint}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const linkCls = "inline-flex items-center gap-1 text-[13px] font-medium text-accent-text hover:underline";

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
  const [ov, campaignMeta, states] = await Promise.all([getOverview(ctx, acc, filters, rankBy), listCampaignMeta({ workspaceId: ctx.workspaceId, adAccountId: acc.id }), loadRecStates(ctx.workspaceId, acc.id)]);
  const campaigns = campaignMeta.map((c) => ({ id: c.id, name: c.name, group: c.group }));
  const qs = filtersToQuery(filters);
  const cur = account.currency;
  const kind = ov.kind;
  const sales = kind === "purchases";
  const resultLabel = RESULT_LABEL[kind];
  const periodDays = daysBetweenInclusive(filters.from, filters.to);
  const description = `${fmtRange(filters.from, filters.to)} · comparado aos ${periodDays} dias anteriores`;

  if (!ov.hasAnyData) {
    return (
      <>
        <PageHeader data={data} title="Visão geral" description={description} campaigns={campaigns} />
        <EmptyPeriodState ws={ws} qsWithout={filtersToQuery({ account: filters.account, preset: "30d" })} />
      </>
    );
  }

  const spark = (key: KpiKey): Array<number | null> | undefined => {
    switch (key) {
      case "spend":
        return ov.series.map((p) => p.spend);
      case "purchaseValue":
        return ov.series.map((p) => p.revenue);
      case "purchases":
        return ov.series.map((p) => p.purchases);
      case "costPerPurchase":
      case "costPerLead":
      case "costPerConversation":
        return ov.series.map((p) => p.cpr);
      default:
        return undefined;
    }
  };

  const recs = applyStates(ov.recommendations.items, states);
  const openCount = recs.filter((r) => r.status === "new").length;
  const canEdit = ctx.role !== "viewer";
  const th = ov.ranking.thresholds;
  const rankOptions = RANK_OPTIONS.filter((o) => (sales ? o.salesOnly : !o.salesOnly));
  const recsQs = qs;

  return (
    <>
      <PageHeader data={data} title="Visão geral" description={description} campaigns={campaigns} />
      <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 py-6 sm:px-8 sm:py-8">
        {kind === "messaging" ? (
          <p className="text-[13px] text-ink-3">Conversas iniciadas não são vendas confirmadas: para medir vendas desse canal é preciso uma fonte de vendas (CRM ou checkout).</p>
        ) : null}

        {/* 1) Resumo: número principal + indicadores de apoio */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <HeroSummary ov={ov} currency={cur} periodDays={periodDays} target={{ roas: ctx.settings.roasTarget, cpa: ctx.settings.cpaTarget }} />
          <KpiTiles ov={ov} currency={cur} tiles={TILES[kind].map((k) => ({ key: k, spark: spark(k) }))} />
        </div>

        {/* 2) Tendência e funil (esquerda) · atenção e distribuição (direita) */}
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <Section title="Tendência diária" i={2} hint={<Hint label="Sobre o gráfico"><p>Valores diários em {cur}, no fuso da conta. Barras e pontos do dia de hoje são parciais. Marque “Período anterior” para comparar com os {periodDays} dias anteriores.</p></Hint>}>
              <TrendTabs data={ov.series} currency={cur} revenueTracked={ov.tracking.purchase} roasTarget={ctx.settings.roasTarget} resultLabel={resultLabel.plural[0].toUpperCase() + resultLabel.plural.slice(1)} costLabel={resultLabel.cost} />
            </Section>
            <Section
              title={ov.funnel.custom ? `Funil · ${ov.funnel.name}` : "Funil de conversão"}
              i={4}
              hint={<FunnelCaveat warnings={ov.funnel.warnings} />}
              action={
                <Link href={`/w/${ws}/funis${qs}`} className={linkCls}>
                  Funis <ArrowRight size={14} />
                </Link>
              }
            >
              <FunnelFlow result={ov.funnel} currency={cur} />
            </Section>
          </div>
          <div className="order-first flex min-w-0 flex-col gap-5 xl:order-none">
            <Section
              title="O que merece atenção"
              i={3}
              className="bg-page shadow-none"
              hint={
                <Hint label="Como as recomendações são geradas" align="end">
                  <p>Regras explícitas do Growth OS aplicadas aos dados deste período e destes filtros: funil analisado de baixo para cima, volume mínimo por regra, comparação com os {periodDays} dias anteriores e suas metas.</p>
                  <p className="mt-1.5">São sugestões: nada é alterado na Meta.</p>
                </Hint>
              }
              action={
                <Link href={`/w/${ws}/recomendacoes${recsQs}`} className={linkCls}>
                  Ver todas {openCount ? <span className="tnum">({openCount})</span> : null} <ArrowRight size={14} />
                </Link>
              }
            >
              <OpenRecs
                items={recs}
                limit={3}
                ws={ws}
                accountId={acc.id}
                qs={qs}
                canEdit={canEdit}
                periodLabel={ov.recommendations.period.label}
                comparisonLabel={ov.recommendations.comparison.label}
                generatedAt={ov.recommendations.generatedAt}
              />
              {freshness.stale && freshness.staleReason ? <p className="mt-3 text-[12.5px] text-warn">{freshness.staleReason}</p> : null}
            </Section>
            <Section
              title="Onde o dinheiro foi"
              i={5}
              hint={<Hint label="Sobre a contribuição por campanha"><p>Participação de cada campanha no investimento{ov.tracking.purchase ? " e na receita atribuída" : ""}. Campanha que consome mais do que traz merece atenção.</p></Hint>}
              action={
                <Link href={`/w/${ws}/campanhas${qs}`} className={linkCls}>
                  Campanhas <ArrowRight size={14} />
                </Link>
              }
            >
              <CampaignContribution rows={ov.campaigns} currency={cur} revenueTracked={ov.tracking.purchase} ws={ws} qs={qs} limit={5} />
            </Section>
          </div>
        </div>

        {/* 4) Melhores anúncios */}
        <Section
          title="Melhores anúncios"
          i={6}
          hint={
            <Hint label="Critério do ranking">
              <p>
                Só entram anúncios com investimento ≥ {fmtCurrency(th.minSpend, cur)} e ≥ {fmtNumber(th.minResults)} {resultLabel.plural}, para que amostras pequenas não virem “melhor anúncio”.
                {ov.ranking.insufficientCount ? ` ${ov.ranking.insufficientCount} anúncios ficaram de fora por dados insuficientes.` : ""}
              </p>
              <p className="mt-1.5">“Volume”: entre os 25% com mais resultados. “Eficiência”: pelo menos 20% melhor que a média da conta. Ranking descritivo, sem teste estatístico.</p>
            </Hint>
          }
          action={
            <nav aria-label="Ordenar ranking" className="flex gap-0.5 rounded-[12px] border border-line bg-surface-2 p-0.5">
              {rankOptions.map((o) => {
                const q = new URLSearchParams(qs.replace(/^\?/, ""));
                q.set("ranking", o.id);
                const active = ov.ranking.rankBy === o.id;
                return (
                  <Link key={o.id} scroll={false} title={o.hint} href={`/w/${ws}/visao-geral?${q}`} aria-current={active ? "true" : undefined} className={cn("rounded-[10px] px-2.5 py-1 text-[12.5px] font-medium text-ink-2 transition-colors hover:text-ink", active && "bg-surface text-ink shadow-card")}>
                    {o.label}
                  </Link>
                );
              })}
            </nav>
          }
        >
          {ov.ranking.top.length ? (
            <AdRankList ads={ov.ranking.top.slice(0, 5)} kind={kind} currency={cur} />
          ) : (
            <p className="text-[13.5px] text-ink-3">Dados insuficientes: nenhum anúncio atingiu o mínimo de investimento e resultados neste período.</p>
          )}
          <Link href={`/w/${ws}/criativos${qs}`} className={cn(linkCls, "mt-4")}>
            Todos os criativos <ArrowRight size={14} />
          </Link>
        </Section>

        {/* 5) Detalhes para gestores (recolhido por padrão) */}
        <details className="disclosure group reveal rounded-[20px] border border-line bg-surface shadow-card" style={{ ["--i" as string]: 7 }}>
          <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-[20px] px-5 py-4 text-[14.5px] font-semibold text-ink hover:bg-surface-2 sm:px-6">
            Mais métricas, posicionamentos e notas de atribuição
            <CaretDown size={16} weight="bold" className="text-ink-3 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-6 border-t border-line px-5 pb-6 pt-5 sm:px-6">
            <div className="grid grid-cols-2 overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-3 xl:grid-cols-6" style={{ gap: 1 }}>
              {MORE[kind].map((key) => (
                <div key={key} className="bg-surface px-4 py-3.5">
                  <p className="flex items-center gap-1 text-[12.5px] text-ink-3">
                    {labelFor(key)}
                    {PLAIN[key] ? (
                      <Hint label={`O que é ${labelFor(key)}`}>
                        <p>{PLAIN[key]}</p>
                      </Hint>
                    ) : null}
                  </p>
                  <p className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-ink tnum">
                    <MetricText m={pickKpi(ov.kpis, key, ov.reach.current)} format={formatFor(key)} currency={cur} />
                  </p>
                </div>
              ))}
            </div>
            <div>
              <h3 className="mb-2 text-[14px] font-semibold text-ink">Plataformas e posicionamentos</h3>
              <Placements rows={ov.placements} currency={cur} revenueTracked={ov.tracking.purchase} />
            </div>
            <ul className="grid grid-cols-1 gap-3 text-[13px] leading-relaxed text-ink-2 md:grid-cols-2">
              <li>Compras e receita são atribuídas pela Meta conforme a janela de cada conjunto e podem diferir das vendas confirmadas no checkout ou CRM.</li>
              <li>ROAS é receita atribuída por real investido. Não é lucro nem ROI.</li>
              <li>Os últimos {process.env.SYNC_RECONCILIATION_DAYS ?? 7} dias são reprocessados a cada sincronização: conversões atrasadas podem mudar os números recentes.</li>
              <li>Metas: ROAS {ctx.settings.roasTarget ? `${fmtNumber(ctx.settings.roasTarget, 2)}×` : "não definida"} · custo por venda {ctx.settings.cpaTarget ? fmtCurrency(ctx.settings.cpaTarget, cur) : "não definido"}.{" "}
                {canEdit ? (
                  <Link href={`/w/${ws}/configuracoes`} className="font-medium text-accent-text hover:underline">
                    Ajustar metas
                  </Link>
                ) : null}
              </li>
            </ul>
          </div>
        </details>
      </main>
    </>
  );
}
