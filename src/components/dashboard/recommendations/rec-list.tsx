"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle } from "@phosphor-icons/react";
import type { RecWithStatus, RecStatus } from "@/server/analytics/recommendation-states";
import { RecCard } from "./rec-card";
import { cn } from "@/lib/cn";

type Common = { ws: string; accountId: string; qs: string; canEdit: boolean; periodLabel: string; comparisonLabel: string; generatedAt: string };

/** Lista das recomendações em aberto (visão geral): as tratadas saem da lista na hora. */
export function OpenRecs({ items, limit, ...c }: Common & { items: RecWithStatus[]; limit: number }) {
  const [statuses, setStatuses] = useState<Record<string, RecStatus>>({});
  const open = items.filter((r) => (statuses[r.key] ?? r.status) === "new").slice(0, limit);
  if (!open.length)
    return (
      <div className="flex flex-col items-start gap-2 rounded-[16px] border border-dashed border-line px-5 py-6 text-[13.5px] text-ink-2">
        <CheckCircle size={20} weight="fill" className="text-good" />
        Nada pendente para este período e filtros.
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <AnimatePresence initial={false} mode="popLayout">
        {open.map((r, i) => (
          <motion.div key={r.key} layout exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}>
            <RecCard rec={r} index={i} onStatus={(k, s) => setStatuses((m) => ({ ...m, [k]: s }))} {...c} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

type Tab = "open" | "reviewed" | "hidden";

/** Lista completa com abas por status. */
export function AllRecs({ items, ...c }: Common & { items: RecWithStatus[] }) {
  const [statuses, setStatuses] = useState<Record<string, RecStatus>>({});
  const [tab, setTab] = useState<Tab>("open");
  const withStatus = useMemo(() => items.map((r) => ({ ...r, status: statuses[r.key] ?? r.status })), [items, statuses]);
  const groups: Record<Tab, RecWithStatus[]> = {
    open: withStatus.filter((r) => r.status === "new"),
    reviewed: withStatus.filter((r) => r.status === "reviewed"),
    hidden: withStatus.filter((r) => r.status === "dismissed" || r.status === "snoozed"),
  };
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "open", label: "Em aberto" },
    { id: "reviewed", label: "Revisadas" },
    { id: "hidden", label: "Dispensadas e adiadas" },
  ];
  const list = groups[tab];
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Status" className="flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-[12px] border border-line bg-surface-2 p-0.5">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("whitespace-nowrap rounded-[10px] px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink", tab === t.id && "bg-surface text-ink shadow-card")}>
            {t.label} <span className="ml-1 text-ink-3 tnum">{groups[t.id].length}</span>
          </button>
        ))}
      </div>
      {list.length ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {list.map((r, i) => (
            <RecCard key={`${r.key}-${r.status}`} rec={r} index={i} onStatus={(k, s) => setStatuses((m) => ({ ...m, [k]: s }))} {...c} />
          ))}
        </div>
      ) : (
        <p className="rounded-[16px] border border-dashed border-line px-5 py-6 text-[13.5px] text-ink-3">{tab === "open" ? "Nenhuma recomendação em aberto para este período e filtros." : "Nada aqui."}</p>
      )}
    </div>
  );
}
