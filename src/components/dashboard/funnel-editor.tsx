"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, X, ArrowUp, ArrowDown, Trash, PencilSimple, CheckCircle, MinusCircle } from "@phosphor-icons/react";
import { saveFunnelAction, deleteFunnelAction } from "@/server/actions/workspace";
import { FUNNEL_METRIC_INFO, FUNNEL_TEMPLATES, type FunnelMetric } from "@/lib/metrics/analysis";
import type { Tracking } from "@/lib/metrics/core";
import { OBJECTIVE_LABEL, type ObjectiveGroup } from "@/lib/metrics/actions";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { cn } from "@/lib/cn";

type Stage = { key: string; label: string; metric: FunnelMetric };
export type FunnelDraft = { id?: string; name: string; kind: "ecommerce" | "leads" | "messaging" | "custom"; stages: Stage[]; campaignIds: string[]; adSetIds: string[] };

const METRICS = Object.keys(FUNNEL_METRIC_INFO) as FunnelMetric[];

export function FunnelEditor({
  ws,
  adAccountId,
  tracking,
  campaigns,
  adSets,
  initial,
  trigger,
}: {
  ws: string;
  adAccountId: string;
  tracking: Tracking;
  campaigns: Array<{ id: string; name: string; group: ObjectiveGroup }>;
  adSets: Array<{ id: string; name: string; campaignId: string }>;
  initial?: FunnelDraft;
  trigger: "new" | "edit";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [d, setD] = useState<FunnelDraft>(initial ?? { name: "", kind: "ecommerce", stages: FUNNEL_TEMPLATES.ecommerce.stages, campaignIds: [], adSetIds: [] });
  const available = (m: FunnelMetric) => {
    const k = FUNNEL_METRIC_INFO[m].trackingKey;
    return k ? tracking[k] : true;
  };
  const move = (i: number, dir: -1 | 1) =>
    setD((x) => {
      const s = [...x.stages];
      const j = i + dir;
      if (j < 0 || j >= s.length) return x;
      [s[i], s[j]] = [s[j], s[i]];
      return { ...x, stages: s };
    });
  const toggle = (field: "campaignIds" | "adSetIds", id: string) => setD((x) => ({ ...x, [field]: x[field].includes(id) ? x[field].filter((v) => v !== id) : [...x[field], id] }));

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        {trigger === "new" ? (
          <Button>
            <Plus size={16} weight="bold" /> Novo funil
          </Button>
        ) : (
          <Button variant="ghost" size="sm">
            <PencilSimple size={15} /> Editar
          </Button>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(100vw,560px)] flex-col border-l border-line bg-surface shadow-pop">
          <div className="border-b border-line px-6 py-5">
            <Dialog.Title className="text-[17px] font-semibold text-ink">{d.id ? "Editar funil" : "Novo funil"}</Dialog.Title>
            <Dialog.Description className="mt-1 text-[13px] text-ink-3">Etapas são contagens agregadas de eventos da Meta. Mapeie as campanhas ou conjuntos que pertencem a este funil.</Dialog.Description>
            <Dialog.Close aria-label="Fechar" className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 hover:bg-surface-2">
              <X size={16} />
            </Dialog.Close>
          </div>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              start(async () => {
                const r = await saveFunnelAction(ws, { ...d, adAccountId });
                if (!r.ok) return setError(r.error);
                setOpen(false);
                router.refresh();
              });
            }}
          >
            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5 scrollbar-thin">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="fn-name" className="text-[13px] font-medium text-ink">
                  Nome
                </label>
                <input id="fn-name" required minLength={2} maxLength={80} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} className={inputClasses} placeholder="Ex.: Loja · campanhas de conversão" />
              </div>
              {!d.id ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-ink">Modelo</span>
                  <div className="flex flex-wrap gap-2">
                    {(["ecommerce", "leads", "messaging"] as const).map((k) => (
                      <button type="button" key={k} onClick={() => setD({ ...d, kind: k, stages: FUNNEL_TEMPLATES[k].stages })} className={cn("rounded-[10px] border px-3 py-1.5 text-[13px]", d.kind === k ? "border-accent bg-accent-soft text-accent-text" : "border-line text-ink-2 hover:border-line-strong")}>
                        {FUNNEL_TEMPLATES[k].name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-[13px] font-medium text-ink">Etapas</legend>
                {d.stages.map((s, i) => (
                  <div key={s.key + i} className="flex items-center gap-2">
                    <span className="w-5 text-right text-[12px] text-ink-3 tnum">{i + 1}</span>
                    <input aria-label={`Nome da etapa ${i + 1}`} value={s.label} onChange={(e) => setD({ ...d, stages: d.stages.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} className={cn(inputClasses, "h-9 flex-1")} />
                    <select aria-label={`Evento da etapa ${i + 1}`} value={s.metric} onChange={(e) => setD({ ...d, stages: d.stages.map((x, j) => (j === i ? { ...x, metric: e.target.value as FunnelMetric } : x)) })} className={cn(inputClasses, "h-9 w-[170px] appearance-auto")}>
                      {METRICS.map((m) => (
                        <option key={m} value={m}>
                          {FUNNEL_METRIC_INFO[m].label}
                          {available(m) ? "" : " (não rastreado)"}
                        </option>
                      ))}
                    </select>
                    <span title={available(s.metric) ? "Evento disponível na conta" : "Evento não rastreado: a etapa aparecerá como indisponível"}>
                      {available(s.metric) ? <CheckCircle size={18} weight="fill" className="text-good" /> : <MinusCircle size={18} className="text-ink-3" />}
                    </span>
                    <button type="button" aria-label="Subir etapa" onClick={() => move(i, -1)} className="grid h-8 w-7 place-items-center rounded text-ink-3 hover:text-ink">
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" aria-label="Descer etapa" onClick={() => move(i, 1)} className="grid h-8 w-7 place-items-center rounded text-ink-3 hover:text-ink">
                      <ArrowDown size={14} />
                    </button>
                    <button type="button" aria-label="Remover etapa" disabled={d.stages.length <= 2} onClick={() => setD({ ...d, stages: d.stages.filter((_, j) => j !== i) })} className="grid h-8 w-7 place-items-center rounded text-ink-3 hover:text-critical disabled:opacity-40">
                      <Trash size={14} />
                    </button>
                  </div>
                ))}
                {d.stages.length < 8 ? (
                  <button type="button" onClick={() => setD({ ...d, kind: "custom", stages: [...d.stages, { key: `s${Date.now().toString(36)}`, label: "Nova etapa", metric: "purchases" }] })} className="mt-1 inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-accent-text hover:underline">
                    <Plus size={14} /> Adicionar etapa
                  </button>
                ) : null}
              </fieldset>
              <fieldset>
                <legend className="text-[13px] font-medium text-ink">Campanhas</legend>
                <p className="mb-2 text-[12.5px] text-ink-3">Nenhuma marcada = todas as campanhas da conta.</p>
                <div className="max-h-[200px] overflow-y-auto rounded-[10px] border border-line scrollbar-thin">
                  {campaigns.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-2 text-[13px] last:border-0 hover:bg-surface-2">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--accent)]" checked={d.campaignIds.includes(c.id)} onChange={() => toggle("campaignIds", c.id)} />
                      <span className="min-w-0 flex-1 truncate text-ink">{c.name}</span>
                      <span className="text-[11.5px] text-ink-3">{OBJECTIVE_LABEL[c.group]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-[13px] font-medium text-ink">Conjuntos de anúncios (opcional)</legend>
                <p className="mb-2 text-[12.5px] text-ink-3">Se marcar conjuntos, eles têm prioridade sobre as campanhas.</p>
                <div className="max-h-[180px] overflow-y-auto rounded-[10px] border border-line scrollbar-thin">
                  {adSets
                    .filter((s) => !d.campaignIds.length || d.campaignIds.includes(s.campaignId))
                    .map((s) => (
                      <label key={s.id} className="flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-2 text-[13px] last:border-0 hover:bg-surface-2">
                        <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--accent)]" checked={d.adSetIds.includes(s.id)} onChange={() => toggle("adSetIds", s.id)} />
                        <span className="min-w-0 flex-1 truncate text-ink">{s.name}</span>
                      </label>
                    ))}
                </div>
              </fieldset>
              {error ? (
                <p role="alert" className="rounded-[10px] bg-critical-soft px-3 py-2 text-[13px] text-critical">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-line px-6 py-4">
              {d.id ? (
                <Button
                  type="button"
                  variant="danger"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      if (!confirm("Excluir este funil?")) return;
                      await deleteFunnelAction(ws, d.id!);
                      setOpen(false);
                      router.refresh();
                    })
                  }
                >
                  <Trash size={15} /> Excluir
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="secondary">
                    Cancelar
                  </Button>
                </Dialog.Close>
                <Button type="submit" disabled={pending}>
                  Salvar funil
                </Button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
