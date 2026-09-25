import { delta, HIGHER_IS_BETTER, type KpiKey, type MetricValue } from "@/lib/metrics/core";
import { METRICS } from "@/lib/metrics/definitions";
import { RESULT_LABEL } from "@/lib/metrics/analysis";
import { fmtCurrency, fmtNumber, fmtRoas, fmtSignedPct, fmtValue, type MetricFormat } from "@/lib/format";
import type { Overview } from "@/server/analytics/dashboard";
import { MetricText } from "@/components/dashboard/metric-value";
import { Delta } from "@/components/dashboard/delta";
import { Sparkline } from "@/components/charts/sparkline";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/cn";

/** Textos curtos de tooltip, em linguagem de dono de negócio. */
export const PLAIN: Partial<Record<KpiKey | "reach" | "frequency", string>> = {
  roas: "Receita atribuída pela Meta para cada R$ 1 investido. Não é lucro: não desconta custo do produto, frete, impostos ou devoluções.",
  purchases: "Compras que a Meta atribuiu aos anúncios, conforme a janela de atribuição de cada conjunto.",
  purchaseValue: "Valor das compras atribuídas aos anúncios. Pode diferir das vendas confirmadas no seu checkout.",
  spend: "Quanto foi gasto em anúncios no período.",
  costPerPurchase: "Investimento dividido pelas vendas atribuídas.",
  averageOrderValue: "Receita atribuída dividida pelas vendas.",
  ctr: "De cada 100 pessoas que viram o anúncio, quantas clicaram no link.",
  cpc: "Custo médio de cada clique no link.",
  cpm: "Custo para exibir o anúncio 1.000 vezes.",
  leads: "Cadastros atribuídos aos anúncios (formulário ou site).",
  costPerLead: "Investimento dividido pelos cadastros.",
  messagingConversations: "Conversas iniciadas por anúncios no WhatsApp, Messenger ou Direct. Não são vendas confirmadas.",
  costPerConversation: "Investimento dividido pelas conversas iniciadas.",
  linkClicks: "Cliques que levaram ao destino do anúncio.",
  impressions: "Vezes que os anúncios foram exibidos.",
  reach: "Pessoas únicas alcançadas no período exato (não é soma de dias).",
  frequency: "Quantas vezes, em média, cada pessoa viu os anúncios.",
  landingPageViews: "Carregamentos da página após o clique (medidos pelo pixel).",
};

const SHORT_LABEL: Partial<Record<KpiKey, string>> = { purchases: "Vendas", costPerPurchase: "Custo por venda", purchaseValue: "Receita atribuída", spend: "Investimento", averageOrderValue: "Ticket médio" };
export const labelFor = (k: KpiKey | "reach" | "frequency") => (k === "reach" ? "Alcance" : k === "frequency" ? "Frequência" : (SHORT_LABEL[k as KpiKey] ?? METRICS[k as KpiKey].label));
export const formatFor = (k: KpiKey | "reach" | "frequency"): MetricFormat => (k === "reach" ? "number" : k === "frequency" ? "decimal" : METRICS[k as KpiKey].format);

type Tile = { key: KpiKey; spark?: Array<number | null> };

/**
 * Resumo principal: um número em destaque (ROAS ou o resultado principal),
 * uma frase em linguagem simples e, quando há meta, um marcador de meta.
 */
export function HeroSummary({ ov, currency, periodDays, target }: { ov: Overview; currency: string; periodDays: number; target: { roas?: number | null; cpa?: number | null } }) {
  const kind = ov.kind;
  const sales = kind === "purchases";
  const heroKey: KpiKey = sales ? "roas" : kind === "leads" ? "leads" : kind === "messaging" ? "messagingConversations" : kind === "linkClicks" ? "linkClicks" : "impressions";
  const cur = ov.kpis[heroKey];
  const prev = ov.prevKpis[heroKey];
  const d = delta(cur, prev);
  const money = (v: number) => fmtCurrency(v, currency);
  const label = RESULT_LABEL[kind];

  let sentence: React.ReactNode = null;
  if (sales && ov.kpis.roas.ok && ov.kpis.purchases.ok) {
    sentence = (
      <>
        Você investiu <strong className="font-semibold text-ink">{money(ov.current.spend)}</strong> e a Meta atribuiu <strong className="font-semibold text-ink">{money(ov.current.purchaseValue)}</strong> em vendas: cerca de <strong className="font-semibold text-ink">{money(ov.kpis.roas.value)}</strong> para cada R$ 1.
      </>
    );
  } else if (!sales) {
    const cpr = kind === "leads" ? ov.kpis.costPerLead : kind === "messaging" ? ov.kpis.costPerConversation : kind === "linkClicks" ? ov.kpis.cpc : ov.kpis.cpm;
    sentence = (
      <>
        Você investiu <strong className="font-semibold text-ink">{money(ov.current.spend)}</strong>
        {cpr.ok ? (
          <>
            {" "}e cada {kind === "impressions" ? "mil impressões custaram" : `${label.singular} custou`} <strong className="font-semibold text-ink">{money(cpr.value)}</strong>.
          </>
        ) : (
          "."
        )}
      </>
    );
  }
  const trend = d.ok && d.pct !== null && Math.abs(d.pct) >= 0.5 ? (
    <>
      {d.pct > 0 === (HIGHER_IS_BETTER[heroKey] ?? true) ? "Melhor" : "Pior"} que nos {periodDays} dias anteriores ({fmtSignedPct(d.pct)}).
    </>
  ) : d.ok ? (
    <>Estável em relação aos {periodDays} dias anteriores.</>
  ) : null;

  return (
    <section aria-label="Resumo" className="reveal flex min-w-0 flex-col justify-between gap-6 rounded-[20px] border border-line bg-surface p-6 shadow-card sm:p-7" style={{ ["--i" as string]: 0 }}>
      <div>
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
          {sales ? "ROAS" : label.plural[0].toUpperCase() + label.plural.slice(1)}
          {PLAIN[heroKey] ? (
            <Hint label={`O que é ${sales ? "ROAS" : label.plural}`}>
              <p>{PLAIN[heroKey]}</p>
            </Hint>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
          <p className="num-hero text-[56px] font-semibold text-ink sm:text-[64px]">
            <MetricText m={cur} format={formatFor(heroKey)} currency={currency} animated />
          </p>
          <Delta d={d} higherIsBetter={HIGHER_IS_BETTER[heroKey]} className="mb-2 text-[13.5px]" />
        </div>
        {sentence ? <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-ink-2">{sentence}</p> : null}
        {trend ? <p className="mt-1 text-[13.5px] text-ink-3">{trend}</p> : null}
      </div>
      {sales && target.roas && ov.kpis.roas.ok ? <TargetBullet value={ov.kpis.roas.value} target={target.roas} fmt={fmtRoas} label="ROAS" /> : null}
      {!sales && heroKey !== "impressions" && prev.ok && cur.ok ? (
        <p className="text-[12.5px] text-ink-3">
          Antes: <span className="text-ink-2 tnum">{fmtValue(prev.value, formatFor(heroKey), currency)}</span>
        </p>
      ) : null}
    </section>
  );
}

/** Bullet chart honesto: escala começa em zero, marcador na meta definida pelo usuário. */
export function TargetBullet({ value, target, fmt, label }: { value: number; target: number; fmt: (v: number) => string; label: string }) {
  const max = Math.max(value, target) * 1.2;
  const reached = value >= target;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[12.5px]">
        <span className="text-ink-3">{label} vs meta</span>
        <span className={cn("font-medium tnum", reached ? "text-good" : "text-ink-2")}>
          {reached ? "Meta atingida" : `Faltam ${fmt(target - value)}`}
        </span>
      </div>
      <div className="relative h-2.5 rounded-full bg-surface-2" role="img" aria-label={`${label} ${fmt(value)}; meta ${fmt(target)}`}>
        <div className="h-2.5 rounded-full bg-s1 transition-[width] duration-700 ease-out" style={{ width: `${(value / max) * 100}%` }} />
        <div className="absolute -top-1 h-[18px] w-[2px] rounded-full bg-ink" style={{ left: `calc(${(target / max) * 100}% - 1px)` }} aria-hidden />
      </div>
      <div className="relative mt-1 h-4 text-[11.5px] text-ink-3 tnum">
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(target / max) * 100}%` }}>
          meta {fmt(target)}
        </span>
      </div>
    </div>
  );
}

/** Grade de indicadores de apoio: linhas finas no lugar de vários cartões. */
export function KpiTiles({ ov, currency, tiles }: { ov: Overview; currency: string; tiles: Tile[] }) {
  return (
    <section aria-label="Indicadores" className="reveal grid grid-cols-2 overflow-hidden rounded-[20px] border border-line bg-line shadow-card" style={{ gap: 1, ["--i" as string]: 1 }}>
      {tiles.map((t) => {
        const cur = ov.kpis[t.key] as MetricValue;
        const prev = ov.prevKpis[t.key] as MetricValue;
        return (
          <div key={t.key} className="flex min-w-0 flex-col justify-between gap-3 bg-surface p-4 sm:p-5">
            <div className="flex items-center gap-1 text-[12.5px] font-medium text-ink-2">
              <span className="truncate">{labelFor(t.key)}</span>
              {PLAIN[t.key] ? (
                <Hint label={`O que é ${labelFor(t.key)}`}>
                  <p>{PLAIN[t.key]}</p>
                </Hint>
              ) : null}
            </div>
            <p className="text-[24px] font-semibold tracking-[-0.03em] text-ink tnum sm:text-[28px]">
              <MetricText m={cur} format={formatFor(t.key)} currency={currency} compact={formatFor(t.key) === "currency" && cur.ok && cur.value >= 100_000} animated />
            </p>
            <div className="flex items-end justify-between gap-2">
              <Delta d={delta(cur, prev)} higherIsBetter={HIGHER_IS_BETTER[t.key]} />
              {t.spark ? <Sparkline values={t.spark} className="h-7 w-[72px] shrink-0 sm:w-[88px]" label={`Tendência diária de ${labelFor(t.key)}`} /> : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function fmtShortMoney(v: number, currency: string) {
  return Math.abs(v) >= 10_000 ? fmtCurrency(v, currency, { compact: true }) : fmtCurrency(v, currency);
}
export { fmtNumber };
