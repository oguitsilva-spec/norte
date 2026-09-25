import * as React from "react";
import { delta, HIGHER_IS_BETTER, type KpiKey, type Kpis, type MetricValue } from "@/lib/metrics/core";
import { METRICS } from "@/lib/metrics/definitions";
import { MetricText } from "./metric-value";
import { Delta } from "./delta";
import { Sparkline } from "@/components/charts/sparkline";
import { MetricInfo } from "./metric-info";
import { cn } from "@/lib/cn";
import type { MetricFormat } from "@/lib/format";

export type KpiSpec = { key: KpiKey | "reach" | "frequency"; label?: string; spark?: Array<number | null>; note?: string };

export function KpiCard({
  spec,
  current,
  previous,
  currency,
  hero,
  format,
  info,
}: {
  spec: KpiSpec;
  current: MetricValue;
  previous: MetricValue;
  currency: string;
  hero?: boolean;
  format: MetricFormat;
  info?: { formula: string; source: string; aggregation: string; attribution?: string };
}) {
  const label = spec.label ?? (spec.key in METRICS ? METRICS[spec.key as KpiKey].label : spec.key);
  const hib = spec.key in HIGHER_IS_BETTER ? HIGHER_IS_BETTER[spec.key as KpiKey] : null;
  return (
    <div className={cn("flex min-w-0 flex-col rounded-[14px] border border-line bg-surface p-4 shadow-card sm:p-5", hero && "ring-1 ring-accent/15")}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
          {label}
          {info ? <MetricInfo label={label} formula={info.formula} source={info.source} aggregation={info.aggregation} attribution={info.attribution} /> : null}
        </span>
        <Delta d={delta(current, previous)} higherIsBetter={hib} />
      </div>
      <div className={cn("mt-2 font-semibold tracking-[-0.03em] text-ink", hero ? "text-[34px] leading-[1.1] sm:text-[40px]" : "text-[26px] leading-[1.15] sm:text-[28px]")}>
        <MetricText m={current} format={format} currency={currency} animated />
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <span className="min-w-0 text-[12px] leading-snug text-ink-3">
          {previous.ok ? (
            <>
              Antes: <MetricText m={previous} format={format} currency={currency} />
            </>
          ) : (
            "Sem dados no período anterior"
          )}
          {spec.note ? <span className="mt-0.5 block">{spec.note}</span> : null}
        </span>
        {spec.spark ? <Sparkline values={spec.spark} className="h-8 w-[96px] shrink-0" label={`Tendência diária de ${label}`} /> : null}
      </div>
    </div>
  );
}

export function kpiFormat(key: KpiSpec["key"]): MetricFormat {
  if (key === "reach") return "number";
  if (key === "frequency") return "decimal";
  return METRICS[key as KpiKey].format;
}

export function pickKpi(k: Kpis, key: KpiSpec["key"], reach: { reach: number | null; frequency: number | null } | null): MetricValue {
  if (key === "reach") return reach?.reach !== null && reach?.reach !== undefined ? { ok: true, value: reach.reach } : { ok: false, reason: "no_data" };
  if (key === "frequency") return reach?.frequency !== null && reach?.frequency !== undefined ? { ok: true, value: reach.frequency } : { ok: false, reason: "no_data" };
  return k[key];
}
