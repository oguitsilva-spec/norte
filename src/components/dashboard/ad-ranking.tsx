import { ChartBar, Lightning, VideoCamera, ImageSquare, ArrowSquareOut } from "@phosphor-icons/react/ssr";
import { RESULT_LABEL, type ResultKind, type RankedAd } from "@/lib/metrics/analysis";
import { fmtCurrency, fmtNumber, fmtRoas, UNAVAILABLE_LABEL } from "@/lib/format";
import { cn } from "@/lib/cn";

export type RankAd = RankedAd & { creative?: { thumbnailUrl?: string | null; isVideo?: boolean } | null; previewLink?: string | null };

export function AdThumb({ url, isVideo, name, className }: { url?: string | null; isVideo?: boolean; name: string; className?: string }) {
  return (
    <div className={cn("relative shrink-0 overflow-hidden bg-surface-2", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Prévia do anúncio ${name}`} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center text-ink-3" title="Sem prévia disponível">
          <ImageSquare size={20} aria-label="Sem prévia disponível" />
        </div>
      )}
      {isVideo ? (
        <span className="absolute bottom-1 left-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white" title="Vídeo">
          <VideoCamera size={11} weight="fill" aria-label="Vídeo" />
        </span>
      ) : null}
    </div>
  );
}

export function Tags({ tags }: { tags: RankedAd["tags"] }) {
  if (!tags.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.includes("volume") ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-px text-[11px] font-medium text-accent-text">
          <ChartBar size={11} weight="bold" /> Volume
        </span>
      ) : null}
      {tags.includes("efficiency") ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-good-soft px-1.5 py-px text-[11px] font-medium text-good">
          <Lightning size={11} weight="fill" /> Eficiência
        </span>
      ) : null}
    </span>
  );
}

/** Ranking compacto: miniatura, nome e poucas métricas alinhadas. */
export function AdRankList({ ads, kind, currency, anchor }: { ads: RankAd[]; kind: ResultKind; currency: string; anchor?: boolean }) {
  const sales = kind === "purchases";
  const label = RESULT_LABEL[kind];
  return (
    <ol className="flex flex-col divide-y divide-line">
      {ads.map((a, i) => (
        <li key={a.id} id={anchor ? `anuncio-${a.id}` : undefined} className="grid scroll-mt-24 grid-cols-[20px_52px_minmax(0,1fr)] items-center gap-3 py-3 target:rounded-[12px] target:bg-accent-soft sm:grid-cols-[20px_56px_minmax(0,1fr)_auto]">
          <span className="text-center text-[13px] font-semibold text-ink-3 tnum">{i + 1}</span>
          <AdThumb url={a.creative?.thumbnailUrl} isVideo={a.creative?.isVideo} name={a.name} className="h-[52px] w-[52px] rounded-[10px] sm:h-14 sm:w-14" />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5">
              <span className="truncate text-[13.5px] font-semibold text-ink" title={a.name}>
                {a.name}
              </span>
              {a.previewLink ? (
                <a href={a.previewLink} target="_blank" rel="noopener noreferrer" aria-label={`Ver prévia de ${a.name} na Meta`} className="shrink-0 text-ink-3 hover:text-accent-text">
                  <ArrowSquareOut size={13} />
                </a>
              ) : null}
            </p>
            <p className="truncate text-[12px] text-ink-3" title={a.campaignName}>
              {a.campaignName}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 sm:hidden">
              <Metrics a={a} sales={sales} currency={currency} label={label.plural} cost={label.cost} />
            </div>
            <div className="mt-1">
              <Tags tags={a.tags} />
            </div>
          </div>
          <div className="hidden items-center gap-5 sm:flex">
            <Metrics a={a} sales={sales} currency={currency} label={label.plural} cost={label.cost} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function Metrics({ a, sales, currency, label, cost }: { a: RankAd; sales: boolean; currency: string; label: string; cost: string }) {
  const items = sales
    ? [
        { l: "ROAS", v: a.kpis.roas.ok ? fmtRoas(a.kpis.roas.value) : UNAVAILABLE_LABEL[a.kpis.roas.reason], strong: true },
        { l: "Vendas", v: fmtNumber(a.results) },
        { l: "Investimento", v: fmtCurrency(a.totals.spend, currency, { compact: a.totals.spend >= 10_000 }) },
      ]
    : [
        { l: label[0].toUpperCase() + label.slice(1), v: fmtNumber(a.results), strong: true },
        { l: cost, v: a.cpr.ok ? fmtCurrency(a.cpr.value, currency) : UNAVAILABLE_LABEL[a.cpr.reason] },
        { l: "Investimento", v: fmtCurrency(a.totals.spend, currency, { compact: a.totals.spend >= 10_000 }) },
      ];
  return (
    <>
      {items.map((m) => (
        <span key={m.l} className="flex flex-col text-right max-sm:text-left">
          <span className="text-[11px] text-ink-3">{m.l}</span>
          <span className={cn("text-[13px] tnum", m.strong ? "font-semibold text-ink" : "text-ink-2")}>{m.v}</span>
        </span>
      ))}
    </>
  );
}

/** Cartão visual de criativo: a miniatura é a protagonista, com poucas métricas. */
export function CreativeTile({ ad, kind, currency, rank, featured }: { ad: RankAd; kind: ResultKind; currency: string; rank: number; featured?: boolean }) {
  const sales = kind === "purchases";
  const label = RESULT_LABEL[kind];
  const metrics = sales
    ? [
        { l: "ROAS", v: ad.kpis.roas.ok ? fmtRoas(ad.kpis.roas.value) : UNAVAILABLE_LABEL[ad.kpis.roas.reason] },
        { l: "Vendas", v: fmtNumber(ad.results) },
        { l: "Custo por venda", v: ad.cpr.ok ? fmtCurrency(ad.cpr.value, currency) : UNAVAILABLE_LABEL[ad.cpr.reason] },
        { l: "Investimento", v: fmtCurrency(ad.totals.spend, currency, { compact: ad.totals.spend >= 10_000 }) },
      ]
    : [
        { l: label.plural[0].toUpperCase() + label.plural.slice(1), v: fmtNumber(ad.results) },
        { l: label.cost, v: ad.cpr.ok ? fmtCurrency(ad.cpr.value, currency) : UNAVAILABLE_LABEL[ad.cpr.reason] },
        { l: "Investimento", v: fmtCurrency(ad.totals.spend, currency, { compact: ad.totals.spend >= 10_000 }) },
      ];
  return (
    <article
      id={`anuncio-${ad.id}`}
      className={cn(
        "group flex min-w-0 scroll-mt-24 overflow-hidden rounded-[18px] border border-line bg-surface shadow-card transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:shadow-pop target:ring-2 target:ring-accent",
        featured ? "flex-col md:col-span-2 md:flex-row" : "flex-col",
      )}
    >
      <div className={cn("relative", featured ? "md:w-[46%]" : "")}>
        <AdThumb url={ad.creative?.thumbnailUrl} isVideo={ad.creative?.isVideo} name={ad.name} className={cn("w-full", featured ? "aspect-[4/3] md:aspect-auto md:h-full md:min-h-[280px]" : "aspect-[4/3]")} />
        <span className="absolute left-3 top-3 grid h-7 min-w-7 place-items-center rounded-full bg-surface/90 px-2 text-[12.5px] font-semibold text-ink shadow-card backdrop-blur tnum">{rank}</span>
      </div>
      <div className={cn("flex flex-1 flex-col gap-3", featured ? "p-6" : "p-4")}>
        <div className="min-w-0">
          <h3 className={cn("truncate font-semibold text-ink", featured ? "text-[18px] tracking-[-0.01em]" : "text-[14px]")} title={ad.name}>
            {ad.name}
          </h3>
          <p className="truncate text-[12.5px] text-ink-3" title={ad.campaignName}>
            {ad.campaignName}
          </p>
        </div>
        <Tags tags={ad.tags} />
        <dl className={cn("grid gap-x-4 gap-y-2.5", featured ? "grid-cols-2 sm:grid-cols-4 md:grid-cols-2" : "grid-cols-2")}>
          {metrics.slice(0, featured ? 4 : sales ? 4 : 3).map((m, i) => (
            <div key={m.l} className="min-w-0">
              <dt className="truncate text-[11.5px] text-ink-3">{m.l}</dt>
              <dd className={cn("tnum", i === 0 ? "font-semibold text-ink" : "text-ink-2", featured && i === 0 ? "text-[26px] tracking-[-0.03em]" : "text-[14px]")}>{m.v}</dd>
            </div>
          ))}
        </dl>
        {featured ? <p className="text-[13px] leading-relaxed text-ink-2">{ad.explanation}</p> : null}
        {ad.previewLink ? (
          <a href={ad.previewLink} target="_blank" rel="noopener noreferrer" className="mt-auto inline-flex items-center gap-1 text-[12.5px] font-medium text-accent-text hover:underline">
            Ver prévia na Meta <ArrowSquareOut size={13} />
          </a>
        ) : null}
      </div>
    </article>
  );
}
