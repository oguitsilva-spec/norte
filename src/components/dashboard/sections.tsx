import Link from "next/link";
import { WarningOctagon, Warning, Info, Sparkle, Trophy, Lightning, ChartBar, ArrowSquareOut, VideoCamera } from "@phosphor-icons/react/ssr";
import type { Overview } from "@/server/analytics/dashboard";
import type { Insight } from "@/lib/metrics/analysis";
import { RESULT_LABEL, type ResultKind, type FunnelResult } from "@/lib/metrics/analysis";
import { fmtCurrency, fmtNumber, fmtPct, fmtRoas, UNAVAILABLE_LABEL } from "@/lib/format";
import type { MetricValue } from "@/lib/metrics/core";
import { Delta } from "./delta";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ */
/* Contribuição por campanha: % do investimento × % da receita         */
/* ------------------------------------------------------------------ */

export function CampaignContribution({ rows, currency, revenueTracked, ws, qs }: { rows: Overview["campaigns"]; currency: string; revenueTracked: boolean; ws: string; qs: string }) {
  const top = rows.slice(0, 7);
  const rest = rows.slice(7);
  const other = rest.length
    ? {
        id: "other",
        name: rest.length === 1 ? "Outra campanha" : `Outras ${rest.length} campanhas`,
        spendShare: rest.reduce((s, r) => s + r.spendShare, 0),
        revenueShare: rest.reduce((s, r) => s + r.revenueShare, 0),
        spend: rest.reduce((s, r) => s + r.totals.spend, 0),
        roas: null as MetricValue | null,
      }
    : null;
  // ROAS só é exibido para campanhas de vendas (ou que tenham compras atribuídas).
  const items = [...top.map((r) => ({ id: r.id, name: r.name, spendShare: r.spendShare, revenueShare: r.revenueShare, spend: r.totals.spend, roas: (r.group === "sales" || r.totals.purchases > 0 ? r.kpis.roas : null) as MetricValue | null, groupLabel: r.groupLabel })), ...(other ? [{ ...other, groupLabel: "" }] : [])];
  const max = Math.max(0.0001, ...items.flatMap((i) => [i.spendShare, revenueTracked ? i.revenueShare : 0]));
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-s2" />% do investimento
        </li>
        {revenueTracked ? (
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-s1" />% da receita atribuída
          </li>
        ) : null}
      </ul>
      <ol className="flex flex-col gap-3.5">
        {items.map((i) => (
          <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5">
            {i.id === "other" ? (
              <span className="truncate text-[13.5px] text-ink-2">{i.name}</span>
            ) : (
              <Link href={`/w/${ws}/campanhas${qs ? `${qs}&` : "?"}c=${i.id}`} className="truncate text-[13.5px] font-medium text-ink hover:text-accent-text hover:underline">
                {i.name}
              </Link>
            )}
            <span className="text-right text-[12.5px] text-ink-2 tnum">
              {fmtCurrency(i.spend, currency, { compact: true })}
              {i.roas ? <span className="ml-2 font-medium text-ink">{i.roas.ok ? fmtRoas(i.roas.value) : UNAVAILABLE_LABEL[i.roas.reason]}</span> : i.groupLabel ? <span className="ml-2 text-ink-3">{i.groupLabel}</span> : null}
            </span>
            <div className="col-span-2 flex flex-col gap-[2px]" role="img" aria-label={`${i.name}: ${fmtPct(i.spendShare * 100)} do investimento${revenueTracked ? `, ${fmtPct(i.revenueShare * 100)} da receita` : ""}`}>
              <div className="flex items-center gap-2">
                <div className="h-2 rounded-r-[4px] bg-s2 transition-[width] duration-700 ease-out" style={{ width: `${(i.spendShare / max) * 100}%`, minWidth: i.spendShare > 0 ? 2 : 0 }} />
                <span className="text-[11.5px] text-ink-3 tnum">{fmtPct(i.spendShare * 100, 0)}</span>
              </div>
              {revenueTracked ? (
                <div className="flex items-center gap-2">
                  <div className="h-2 rounded-r-[4px] bg-s1 transition-[width] duration-700 ease-out" style={{ width: `${(i.revenueShare / max) * 100}%`, minWidth: i.revenueShare > 0 ? 2 : 0 }} />
                  <span className="text-[11.5px] text-ink-3 tnum">{fmtPct(i.revenueShare * 100, 0)}</span>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {items.length === 0 ? <p className="text-[13.5px] text-ink-3">Nenhuma campanha com entrega no período.</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Insights                                                            */
/* ------------------------------------------------------------------ */

const SEV = {
  critical: { icon: WarningOctagon, cls: "text-critical", label: "Crítico" },
  warning: { icon: Warning, cls: "text-warn", label: "Atenção" },
  info: { icon: Info, cls: "text-accent-text", label: "Observação" },
  positive: { icon: Sparkle, cls: "text-good", label: "Destaque" },
} as const;

export function InsightList({ items, stale }: { items: Insight[]; stale?: { message: string } | null }) {
  const all = [...(stale ? [{ id: "stale", severity: "warning" as const, title: "Dados desatualizados ou integração com problema", body: stale.message, metric: "Sincronização", period: "Agora", comparison: "Intervalo esperado de sincronização", rule: "Última sincronização bem-sucedida mais antiga que 3× o intervalo, ou conexão inativa" }] : []), ...items];
  if (!all.length)
    return <p className="px-5 pb-5 text-[13.5px] text-ink-3">Nenhum alerta para o período. As regras avaliadas estão descritas em cada tipo de alerta quando disparam.</p>;
  return (
    <ul className="divide-y divide-line">
      {all.map((i) => {
        const s = SEV[i.severity];
        const Icon = s.icon;
        return (
          <li key={i.id} className="px-5 py-4">
            <div className="flex gap-3">
              <Icon size={18} weight="fill" className={cn("mt-0.5 shrink-0", s.cls)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-ink">
                  <span className="sr-only">{s.label}: </span>
                  {i.title}
                </p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{i.body}</p>
                <details className="group mt-2">
                  <summary className="cursor-pointer list-none text-[12.5px] font-medium text-ink-3 hover:text-ink [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">Ver regra e evidência</span>
                    <span className="hidden group-open:inline">Ocultar regra</span>
                  </summary>
                  <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-[10px] bg-surface-2 px-3 py-2.5 text-[12.5px]">
                    <dt className="text-ink-3">Métrica</dt>
                    <dd className="text-ink-2">{i.metric}</dd>
                    <dt className="text-ink-3">Período</dt>
                    <dd className="text-ink-2">{i.period}</dd>
                    <dt className="text-ink-3">Comparação</dt>
                    <dd className="text-ink-2">{i.comparison}</dd>
                    <dt className="text-ink-3">Regra</dt>
                    <dd className="text-ink-2">{i.rule}</dd>
                  </dl>
                </details>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Melhores anúncios                                                   */
/* ------------------------------------------------------------------ */

type TopAd = Overview["ranking"]["top"][number];

export function Thumb({ url, isVideo, name, className }: { url?: string | null; isVideo?: boolean; name: string; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden bg-surface-2", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Prévia do anúncio ${name}`} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center text-[12px] text-ink-3">Sem prévia disponível</div>
      )}
      {isVideo ? (
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">
          <VideoCamera size={12} weight="fill" /> Vídeo
        </span>
      ) : null}
    </div>
  );
}

export function AdCard({ ad, kind, currency, rank }: { ad: TopAd; kind: ResultKind; currency: string; rank: number }) {
  const label = RESULT_LABEL[kind];
  const sales = kind === "purchases";
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-pop">
      <div className="relative">
        <Thumb url={ad.creative?.thumbnailUrl} isVideo={ad.creative?.isVideo} name={ad.name} className="aspect-[4/3] w-full" />
        <span className="absolute left-2.5 top-2.5 grid h-7 min-w-7 place-items-center rounded-full bg-surface px-2 text-[12.5px] font-semibold text-ink shadow-card tnum">{rank}</span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <h3 className="truncate text-[14px] font-semibold text-ink" title={ad.name}>
            {ad.name}
          </h3>
          <p className="truncate text-[12.5px] text-ink-3" title={ad.campaignName}>
            {ad.campaignName}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ad.tags.includes("volume") ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent-text">
              <ChartBar size={12} weight="bold" /> Alto volume
            </span>
          ) : null}
          {ad.tags.includes("efficiency") ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-good-soft px-2 py-0.5 text-[11.5px] font-medium text-good">
              <Lightning size={12} weight="fill" /> Alta eficiência
            </span>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
          <div>
            <dt className="text-ink-3">Investimento</dt>
            <dd className="font-semibold text-ink tnum">{fmtCurrency(ad.totals.spend, currency)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">{label.plural[0].toUpperCase() + label.plural.slice(1)}</dt>
            <dd className="font-semibold text-ink tnum">{fmtNumber(ad.results)}</dd>
          </div>
          {sales ? (
            <>
              <div>
                <dt className="text-ink-3">Receita</dt>
                <dd className="font-semibold text-ink tnum">{fmtCurrency(ad.totals.purchaseValue, currency)}</dd>
              </div>
              <div>
                <dt className="text-ink-3">ROAS</dt>
                <dd className="font-semibold text-ink tnum">{ad.kpis.roas.ok ? fmtRoas(ad.kpis.roas.value) : UNAVAILABLE_LABEL[ad.kpis.roas.reason]}</dd>
              </div>
            </>
          ) : null}
          <div>
            <dt className="text-ink-3">{label.cost}</dt>
            <dd className="font-semibold text-ink tnum">{ad.cpr.ok ? fmtCurrency(ad.cpr.value, currency) : UNAVAILABLE_LABEL[ad.cpr.reason]}</dd>
          </div>
        </dl>
        <p className="mt-auto border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink-2">{ad.explanation}</p>
        {ad.previewLink ? (
          <a href={ad.previewLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent-text hover:underline">
            Ver prévia na Meta <ArrowSquareOut size={13} />
          </a>
        ) : null}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Funil agregado                                                      */
/* ------------------------------------------------------------------ */

export function FunnelView({ result, currency, compact }: { result: FunnelResult; currency: string; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col">
        {result.stages.map((s, idx) => {
          // A barra mostra a TAXA em relação à etapa anterior (0-100%). Acima de 100% a barra
          // enche e a etapa é sinalizada; o número exibido nunca é limitado.
          const w = !s.value.ok ? 0 : s.rateFromPrev === null ? 100 : s.rateFromPrev.ok ? Math.min(100, s.rateFromPrev.value) : 0;
          return (
            <li key={s.key} className={cn("grid items-center gap-x-4 gap-y-1 py-3", compact ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] max-md:grid-cols-[minmax(0,1fr)_auto]", idx > 0 && "border-t border-line")}>
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
                  {s.label}
                  {s.isBottleneck ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-serious-soft px-2 py-0.5 text-[11px] font-semibold text-serious">
                      <Warning size={11} weight="fill" /> Maior perda
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-[12px] text-ink-3" title={s.definition}>
                  {s.definition}
                </p>
                <div className="mt-2 h-2 w-full rounded-[4px] bg-accent-soft" aria-hidden>
                  <div className={cn("h-2 rounded-[4px] transition-[width] duration-700 ease-out", s.exceedsPrev ? "bg-s4" : "bg-s1")} style={{ width: `${w}%`, minWidth: w > 0 ? 3 : 0 }} />
                </div>
              </div>
              {!compact ? (
                <div className="text-[12.5px] text-ink-2 max-md:col-span-2 max-md:row-start-2">
                  {s.rateFromPrev ? (
                    s.rateFromPrev.ok ? (
                      <p>
                        <span className={cn("font-semibold tnum", s.exceedsPrev ? "text-warn" : "text-ink")}>{fmtPct(s.rateFromPrev.value)}</span> da etapa anterior
                        {s.dropOff?.ok ? <span className="text-ink-3"> · perda de {fmtPct(s.dropOff.value)}</span> : null}
                        {s.exceedsPrev ? <span className="block text-warn">Acima de 100%: eventos agregados, não as mesmas pessoas</span> : null}
                      </p>
                    ) : (
                      <p className="text-ink-3">Taxa indisponível</p>
                    )
                  ) : (
                    <p className="text-ink-3">Etapa inicial</p>
                  )}
                  <p className="text-ink-3">
                    Custo por evento: <span className="text-ink-2 tnum">{s.costPerEvent.ok ? fmtCurrency(s.costPerEvent.value, currency) : UNAVAILABLE_LABEL[s.costPerEvent.reason]}</span>
                  </p>
                </div>
              ) : null}
              <div className="text-right">
                <p className="text-[18px] font-semibold tracking-[-0.02em] text-ink tnum">{s.value.ok ? fmtNumber(s.value.value) : <span className="text-[13px] font-medium text-ink-3">{UNAVAILABLE_LABEL[s.value.reason]}</span>}</p>
                <Delta d={s.change} higherIsBetter={true} />
              </div>
            </li>
          );
        })}
      </ol>
      {result.warnings.length ? (
        <ul className="flex flex-col gap-1.5 rounded-[10px] bg-surface-2 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-2">
          {result.warnings.map((w) => (
            <li key={w} className="flex gap-2">
              <Info size={14} className="mt-0.5 shrink-0 text-ink-3" />
              {w}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Posicionamentos                                                     */
/* ------------------------------------------------------------------ */

const PLATFORM: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", audience_network: "Audience Network", messenger: "Messenger", threads: "Threads", unknown: "Não informado" };
const POSITION: Record<string, string> = {
  feed: "Feed",
  reels: "Reels",
  story: "Stories",
  facebook_reels: "Reels",
  classic: "Clássico",
  messenger_inbox: "Caixa de entrada",
  instagram_explore: "Explorar",
  instagram_stories: "Stories",
  marketplace: "Marketplace",
  video_feeds: "Vídeos",
  search: "Pesquisa",
  right_hand_column: "Coluna direita",
  unknown: "Não informado",
};

export function Placements({ rows, currency, revenueTracked }: { rows: Overview["placements"]; currency: string; revenueTracked: boolean }) {
  const total = rows.reduce((s, r) => s + r.spend, 0);
  if (!rows.length) return <p className="px-5 pb-5 text-[13.5px] text-ink-3">Sem dados de posicionamento para o período.</p>;
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[520px] text-[13px]">
        <caption className="sr-only">Desempenho por plataforma e posicionamento</caption>
        <thead>
          <tr className="text-left text-[12px] text-ink-3">
            <th className="px-5 py-2 font-medium">Posicionamento</th>
            <th className="px-3 py-2 font-medium">% do investimento</th>
            <th className="px-3 py-2 text-right font-medium">Investimento</th>
            {revenueTracked ? <th className="px-3 py-2 text-right font-medium">ROAS</th> : null}
            <th className="px-5 py-2 text-right font-medium">CTR (link)</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((r) => {
            const share = total ? r.spend / total : 0;
            return (
              <tr key={`${r.platform}-${r.position}`} className="border-t border-line">
                <td className="px-5 py-2.5 text-ink">
                  {PLATFORM[r.platform] ?? r.platform} <span className="text-ink-3">· {POSITION[r.position] ?? r.position.replace(/_/g, " ")}</span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 max-w-full">
                      <div className="h-1.5 rounded-r-[3px] bg-s2" style={{ width: `${share * 100}%` }} />
                    </div>
                    <span className="text-ink-2 tnum">{fmtPct(share * 100, 0)}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right text-ink tnum">{fmtCurrency(r.spend, currency)}</td>
                {revenueTracked ? <td className="px-3 py-2.5 text-right font-medium text-ink tnum">{r.spend > 0 ? fmtRoas(r.purchaseValue / r.spend) : "n/d"}</td> : null}
                <td className="px-5 py-2.5 text-right text-ink-2 tnum">{r.impressions > 0 ? fmtPct((r.linkClicks / r.impressions) * 100, 2) : "n/d"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-5 py-3 text-[12px] text-ink-3">Quebra por publisher_platform + platform_position no nível de campanha. Compras por posicionamento seguem a mesma atribuição; podem não somar exatamente o total da conta por arredondamento da Meta.</p>
    </div>
  );
}

export { Trophy };
