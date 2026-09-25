"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarBlank, Check, CaretDown, X } from "@phosphor-icons/react";
import { PRESET_LABEL } from "@/lib/filters";
import type { DatePreset } from "@/lib/metrics/core";
import { OBJECTIVE_LABEL, type ObjectiveGroup } from "@/lib/metrics/actions";
import { fmtRange } from "@/lib/format";
import { cn } from "@/lib/cn";
import { selectAccountAction } from "@/server/actions/workspace";

type Props = {
  ws: string;
  accounts: Array<{ id: string; name: string; currency: string }>;
  accountId: string | null;
  preset: DatePreset;
  from: string;
  to: string;
  today: string;
  campaigns?: Array<{ id: string; name: string; group: ObjectiveGroup }>;
  campaignId?: string | null;
  objective?: ObjectiveGroup | null;
  showCampaign?: boolean;
};

const PRESETS: DatePreset[] = ["today", "7d", "14d", "30d", "90d", "mtd", "last_month"];
const triggerCls =
  "inline-flex h-9 max-w-full items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[13.5px] text-ink transition-colors hover:border-line-strong data-[state=open]:border-accent";

export function FilterBar(p: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [custom, setCustom] = useState({ from: p.from, to: p.to });
  const [dateOpen, setDateOpen] = useState(false);

  const push = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    start(() => router.push(`${pathname}?${q.toString()}`, { scroll: false }));
  };

  const groups = p.campaigns ? Array.from(new Set(p.campaigns.map((c) => c.group))) : [];
  const visibleCampaigns = (p.campaigns ?? []).filter((c) => !p.objective || c.group === p.objective).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-70")} aria-busy={pending}>
      {p.accounts.length > 0 ? (
        <label className="relative inline-flex">
          <span className="sr-only">Conta de anúncios</span>
          <select
            className={cn(triggerCls, "appearance-none pr-8 font-medium")}
            value={p.accountId ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              void selectAccountAction(p.ws, id);
              push({ conta: id, campanha: null });
            }}
          >
            {p.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </select>
          <CaretDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" />
        </label>
      ) : null}

      <Popover.Root open={dateOpen} onOpenChange={setDateOpen}>
        <Popover.Trigger className={triggerCls} aria-label="Período">
          <CalendarBlank size={16} className="text-ink-3" />
          <span className="font-medium">{PRESET_LABEL[p.preset]}</span>
          <span className="hidden text-ink-3 sm:inline tnum">{fmtRange(p.from, p.to)}</span>
          <CaretDown size={13} className="text-ink-3" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={6} className="z-50 w-[280px] rounded-[12px] border border-line bg-surface p-1.5 shadow-pop">
            <div role="listbox" aria-label="Períodos">
              {PRESETS.map((pr) => (
                <button
                  key={pr}
                  role="option"
                  aria-selected={p.preset === pr}
                  onClick={() => {
                    setDateOpen(false);
                    push({ periodo: pr, de: null, ate: null });
                  }}
                  className="flex w-full items-center justify-between rounded-[8px] px-2.5 py-2 text-left text-[13.5px] text-ink hover:bg-surface-2"
                >
                  {PRESET_LABEL[pr]}
                  {p.preset === pr ? <Check size={16} weight="bold" className="text-accent-text" /> : null}
                </button>
              ))}
            </div>
            <form
              className="mt-1 border-t border-line px-2.5 pb-1.5 pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (custom.from > custom.to) return;
                setDateOpen(false);
                push({ periodo: "custom", de: custom.from, ate: custom.to });
              }}
            >
              <p className="mb-2 text-[12.5px] font-medium text-ink-2">Intervalo personalizado</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-[12px] text-ink-3">
                  De
                  <input type="date" max={p.today} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="h-8 rounded-[8px] border border-line-strong bg-surface px-2 text-[13px] text-ink" />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-ink-3">
                  Até
                  <input type="date" max={p.today} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="h-8 rounded-[8px] border border-line-strong bg-surface px-2 text-[13px] text-ink" />
                </label>
              </div>
              {custom.from > custom.to ? <p className="mt-1.5 text-[12px] text-critical">A data inicial deve ser anterior à final.</p> : null}
              <button type="submit" className="mt-2.5 h-8 w-full rounded-[8px] bg-accent text-[13px] font-medium text-accent-ink hover:bg-accent-hover">
                Aplicar
              </button>
            </form>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {p.showCampaign !== false && groups.length > 1 ? (
        <label className="relative inline-flex">
          <span className="sr-only">Objetivo</span>
          <select className={cn(triggerCls, "appearance-none pr-8")} value={p.objective ?? ""} onChange={(e) => push({ objetivo: e.target.value || null, campanha: null })}>
            <option value="">Todos os objetivos</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {OBJECTIVE_LABEL[g]}
              </option>
            ))}
          </select>
          <CaretDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" />
        </label>
      ) : null}

      {p.showCampaign !== false && p.campaigns && p.campaigns.length > 0 ? (
        <label className="relative inline-flex min-w-0">
          <span className="sr-only">Campanha</span>
          <select className={cn(triggerCls, "max-w-[260px] appearance-none truncate pr-8")} value={p.campaignId ?? ""} onChange={(e) => push({ campanha: e.target.value || null })}>
            <option value="">Todas as campanhas</option>
            {visibleCampaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <CaretDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" />
        </label>
      ) : null}

      {p.campaignId || p.objective ? (
        <button onClick={() => push({ campanha: null, objetivo: null })} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink">
          <X size={14} /> Limpar filtros
        </button>
      ) : null}
    </div>
  );
}
