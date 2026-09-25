"use client";

import { useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, BarChart, Bar, Cell, Area, ComposedChart } from "recharts";
import { useReducedMotion } from "motion/react";
import type { SeriesPoint } from "@/server/analytics/dashboard";
import { fmtCurrency, fmtShortDate, fmtDate, fmtNumber, fmtRoas } from "@/lib/format";
import { cn } from "@/lib/cn";

const axisTick = { fill: "var(--ink-3)", fontSize: 11.5 };
const tickDate = (d: string) => fmtShortDate(d);

type Row = { label: string; color: string; value: string; muted?: boolean };

function TooltipBox({ date, partial, rows }: { date: string; partial?: boolean; rows: Row[] }) {
  return (
    <div className="min-w-[190px] rounded-[10px] border border-line bg-surface px-3 py-2.5 text-[12.5px] shadow-pop">
      <p className="mb-1.5 font-medium text-ink">
        {fmtDate(date)}
        {partial ? <span className="ml-1.5 font-normal text-warn">dia em andamento</span> : null}
      </p>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2">
            <span aria-hidden className="h-[2px] w-3 rounded-full" style={{ background: r.color }} />
            <span className={cn("flex-1", r.muted ? "text-ink-3" : "text-ink-2")}>{r.label}</span>
            <span className={cn("font-semibold tnum", r.muted ? "text-ink-2" : "text-ink")}>{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Legend({ items }: { items: Array<{ label: string; color: string; kind?: "line" | "bar" }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={i.kind === "bar" ? "h-2.5 w-2.5 rounded-[3px]" : "h-[2px] w-3.5 rounded-full"} style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function ComparisonToggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-2">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
      Período anterior
    </label>
  );
}

/** Investimento × Receita atribuída - mesma unidade (moeda da conta), um único eixo. */
export function SpendRevenueChart({ data, currency, revenueTracked }: { data: SeriesPoint[]; currency: string; revenueTracked: boolean }) {
  const reduce = useReducedMotion();
  const [prev, setPrev] = useState(false);
  const money = (v: number) => (Math.abs(v) >= 10_000 ? fmtCurrency(v, currency, { compact: true }) : fmtCurrency(v, currency, { decimals: 0 }));
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend
          items={[
            ...(revenueTracked ? [{ label: "Receita atribuída", color: "var(--series-1)" }] : []),
            { label: "Investimento", color: "var(--series-2)" },
            ...(prev ? [{ label: "Período anterior", color: "var(--series-prev)" }] : []),
          ]}
        />
        <ComparisonToggle on={prev} set={setPrev} />
      </div>
      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="date" tickFormatter={tickDate} tick={axisTick} axisLine={{ stroke: "var(--axis)" }} tickLine={false} minTickGap={24} />
            <YAxis tickFormatter={money} tick={axisTick} axisLine={false} tickLine={false} width={84} />
            <Tooltip
              cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                const p = active && payload?.[0]?.payload as SeriesPoint | undefined;
                if (!p) return null;
                const rows: Row[] = [];
                if (revenueTracked) rows.push({ label: "Receita atribuída", color: "var(--series-1)", value: p.revenue === null ? "Sem dados" : fmtCurrency(p.revenue, currency) });
                rows.push({ label: "Investimento", color: "var(--series-2)", value: p.spend === null ? "Sem dados" : fmtCurrency(p.spend, currency) });
                if (revenueTracked) rows.push({ label: "ROAS do dia", color: "transparent", value: p.roas === null ? "n/d" : fmtRoas(p.roas) });
                if (prev) {
                  if (revenueTracked) rows.push({ label: "Receita (anterior)", color: "var(--series-prev)", value: p.prevRevenue === null ? "Sem dados" : fmtCurrency(p.prevRevenue, currency), muted: true });
                  rows.push({ label: "Investimento (anterior)", color: "var(--series-prev)", value: p.prevSpend === null ? "Sem dados" : fmtCurrency(p.prevSpend, currency), muted: true });
                }
                return <TooltipBox date={p.date} partial={p.partial} rows={rows} />;
              }}
            />
            {prev && revenueTracked ? <Line type="monotone" dataKey="prevRevenue" stroke="var(--series-prev)" strokeWidth={1.5} dot={false} isAnimationActive={!reduce} connectNulls={false} /> : null}
            {prev ? <Line type="monotone" dataKey="prevSpend" stroke="var(--series-prev)" strokeWidth={1.5} strokeOpacity={0.7} dot={false} isAnimationActive={!reduce} /> : null}
            {revenueTracked ? <Area type="monotone" dataKey="revenue" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.08} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={!reduce} animationDuration={700} /> : null}
            <Line type="monotone" dataKey="spend" stroke="var(--series-2)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={!reduce} animationDuration={700} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** ROAS diário - eixo próprio em "×", separado de valores monetários. */
export function RoasChart({ data, target }: { data: SeriesPoint[]; target?: number | null }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex h-full flex-col gap-3">
      <Legend items={[{ label: "ROAS diário", color: "var(--series-1)" }, ...(target ? [{ label: `Meta ${fmtRoas(target)}`, color: "var(--ink-3)" }] : [])]} />
      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="date" tickFormatter={tickDate} tick={axisTick} axisLine={{ stroke: "var(--axis)" }} tickLine={false} minTickGap={24} />
            <YAxis tickFormatter={(v: number) => `${fmtNumber(v, 1)}×`} tick={axisTick} axisLine={false} tickLine={false} width={44} domain={[0, "auto"]} />
            {target ? <ReferenceLine y={target} stroke="var(--ink-3)" strokeWidth={1} ifOverflow="extendDomain" /> : null}
            <Tooltip
              cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                const p = active && payload?.[0]?.payload as SeriesPoint | undefined;
                if (!p) return null;
                return (
                  <TooltipBox
                    date={p.date}
                    partial={p.partial}
                    rows={[
                      { label: "ROAS", color: "var(--series-1)", value: p.roas === null ? (p.spend === 0 ? "Sem investimento" : "Sem dados") : fmtRoas(p.roas) },
                      ...(p.prevRoas !== null ? [{ label: "ROAS (anterior)", color: "var(--series-prev)", value: fmtRoas(p.prevRoas), muted: true }] : []),
                    ]}
                  />
                );
              }}
            />
            <Line type="monotone" dataKey="roas" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={!reduce} animationDuration={700} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Resultados por dia (compras, leads…) - colunas; o dia em andamento fica esmaecido. */
export function ResultsChart({ data, label, currency, costLabel }: { data: SeriesPoint[]; label: string; currency: string; costLabel: string }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex h-full flex-col gap-3">
      <Legend items={[{ label, color: "var(--series-1)", kind: "bar" }]} />
      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="date" tickFormatter={tickDate} tick={axisTick} axisLine={{ stroke: "var(--axis)" }} tickLine={false} minTickGap={24} />
            <YAxis tickFormatter={(v: number) => fmtNumber(v)} tick={axisTick} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) => {
                const p = active && payload?.[0]?.payload as SeriesPoint | undefined;
                if (!p) return null;
                return (
                  <TooltipBox
                    date={p.date}
                    partial={p.partial}
                    rows={[
                      { label, color: "var(--series-1)", value: p.results === null ? "Sem dados" : fmtNumber(p.results) },
                      { label: costLabel, color: "transparent", value: p.cpr === null ? "n/d" : fmtCurrency(p.cpr, currency) },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="results" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={!reduce} animationDuration={600}>
              {data.map((d) => (
                <Cell key={d.date} fill="var(--series-1)" fillOpacity={d.partial ? 0.35 : 1} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
