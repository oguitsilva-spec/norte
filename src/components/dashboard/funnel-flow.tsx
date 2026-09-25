import { Fragment } from "react";
import { Warning, MagnifyingGlass } from "@phosphor-icons/react/ssr";
import type { FunnelResult } from "@/lib/metrics/analysis";
import { fmtCurrency, fmtNumber, fmtPct, UNAVAILABLE_LABEL } from "@/lib/format";
import { Delta } from "./delta";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/cn";

/**
 * Funil visual: volume de cada etapa e, entre as etapas, a taxa de passagem
 * (barra de 0 a 100%). A etapa com maior perda pós-clique é destacada.
 * Taxas acima de 100% NÃO são limitadas - são sinalizadas.
 */
export function FunnelFlow({ result, currency, showCost = false }: { result: FunnelResult; currency: string; showCost?: boolean }) {
  const stages = result.stages;
  return (
    <ol className="flex flex-col">
      {stages.map((s, idx) => {
        const rate = s.rateFromPrev;
        const w = rate && rate.ok ? Math.min(100, rate.value) : 0;
        return (
          <Fragment key={s.key}>
            {idx > 0 ? (
              <li aria-hidden={!rate} className={cn("relative ml-[11px] flex items-center gap-3 border-l border-dashed py-2 pl-5", s.isBottleneck ? "border-serious/60" : "border-line-strong")}>
                {rate ? (
                  rate.ok ? (
                    <div className={cn("flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] px-2.5 py-1.5", s.isBottleneck ? "bg-serious-soft" : "")}>
                      <div className="h-1.5 w-[88px] shrink-0 rounded-full bg-surface-2 sm:w-[120px]">
                        <div className={cn("h-1.5 rounded-full transition-[width] duration-700 ease-out", s.exceedsPrev ? "bg-s4" : s.isBottleneck ? "bg-serious" : "bg-s1")} style={{ width: `${w}%`, minWidth: w > 0 ? 3 : 0 }} />
                      </div>
                      <span className="text-[12.5px] text-ink-2">
                        <span className={cn("font-semibold tnum", s.isBottleneck ? "text-serious" : "text-ink")}>{fmtPct(rate.value, rate.value < 10 ? 2 : 1)}</span> seguem
                      </span>
                      {s.isBottleneck ? (
                        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-serious">
                          <MagnifyingGlass size={12} weight="bold" /> Investigar aqui
                        </span>
                      ) : null}
                      {s.exceedsPrev ? (
                        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-warn">
                          <Warning size={12} weight="fill" /> acima de 100%
                          <Hint label="Por que passa de 100%">
                            <p>Mais eventos que na etapa anterior. Com eventos agregados isso acontece (uma pessoa gera vários eventos, ou conversões atribuídas por visualização sem clique). A taxa não é limitada a 100%.</p>
                          </Hint>
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-[12px] text-ink-3">taxa indisponível</span>
                  )
                ) : null}
              </li>
            ) : null}
            <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
              <span className={cn("grid h-[23px] w-[23px] place-items-center rounded-full border text-[11px] font-semibold tnum", s.isBottleneck ? "border-serious bg-serious-soft text-serious" : "border-line-strong bg-surface text-ink-2")}>{idx + 1}</span>
              <span className="flex min-w-0 items-center gap-1 text-[13.5px] font-medium text-ink">
                <span className="truncate">{s.label}</span>
                <Hint label={`Como ${s.label} é medido`}>
                  <p>{s.definition}</p>
                  {showCost ? null : s.costPerEvent.ok ? <p className="mt-1.5 text-ink-3">Custo por evento: {fmtCurrency(s.costPerEvent.value, currency)}</p> : null}
                </Hint>
              </span>
              <span className="flex items-baseline gap-2 text-right">
                {showCost ? <span className="hidden text-[12px] text-ink-3 tnum sm:inline">{s.costPerEvent.ok ? `${fmtCurrency(s.costPerEvent.value, currency)}/evento` : ""}</span> : null}
                <span className="text-[17px] font-semibold tracking-[-0.02em] text-ink tnum">{s.value.ok ? fmtNumber(s.value.value) : <span className="text-[13px] font-medium text-ink-3">{UNAVAILABLE_LABEL[s.value.reason]}</span>}</span>
                {showCost ? <Delta d={s.change} higherIsBetter={true} className="hidden w-[64px] justify-end sm:inline-flex" /> : null}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

/** Nota curta e discreta sobre as limitações do funil agregado, para o cabeçalho. */
export function FunnelCaveat({ warnings }: { warnings: string[] }) {
  return (
    <Hint label="Limitações do funil agregado" align="end">
      <p className="font-medium text-ink">Funil de eventos agregados</p>
      <p className="mt-1">Cada etapa soma eventos contados pela Meta no período. Não são necessariamente as mesmas pessoas avançando em ordem: as taxas indicam onde investigar, não uma conversão verificada.</p>
      {warnings.map((w) => (
        <p key={w} className="mt-1.5">
          {w}
        </p>
      ))}
    </Hint>
  );
}
