"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { SeriesPoint } from "@/server/analytics/dashboard";
import { SpendRevenueChart, RoasChart, ResultsChart } from "@/components/charts/trend-charts";
import { cn } from "@/lib/cn";

type Tab = "money" | "roas" | "results";

/** Um só gráfico com abas, em vez de três cartões de gráfico concorrendo por atenção. */
export function TrendTabs({ data, currency, revenueTracked, roasTarget, resultLabel, costLabel }: { data: SeriesPoint[]; currency: string; revenueTracked: boolean; roasTarget?: number | null; resultLabel: string; costLabel: string }) {
  const reduce = useReducedMotion();
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "money", label: revenueTracked ? "Receita e investimento" : "Investimento" },
    ...(revenueTracked ? [{ id: "roas" as const, label: "ROAS" }] : []),
    { id: "results", label: resultLabel },
  ];
  const [tab, setTab] = useState<Tab>("money");
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div role="tablist" aria-label="Tendência diária" className="flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-[12px] border border-line bg-surface-2 p-0.5 scrollbar-thin">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn("relative whitespace-nowrap rounded-[10px] px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink", tab === t.id && "text-ink")}
          >
            {tab === t.id ? <motion.span layoutId="trend-tab" transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }} className="absolute inset-0 rounded-[10px] bg-surface shadow-card" /> : null}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex min-h-[300px] flex-1 flex-col">
        {tab === "money" ? <SpendRevenueChart data={data} currency={currency} revenueTracked={revenueTracked} /> : null}
        {tab === "roas" ? <RoasChart data={data} target={roasTarget} /> : null}
        {tab === "results" ? <ResultsChart data={data} label={resultLabel} currency={currency} costLabel={costLabel} /> : null}
      </div>
    </div>
  );
}
