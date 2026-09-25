"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, CaretDown, Check, Clock, X, ArrowCounterClockwise, WarningOctagon, Warning, Circle, ArrowSquareOut } from "@phosphor-icons/react";
import { setRecommendationStatusAction } from "@/server/actions/recommendations";
import { CATEGORY_LABEL, PRIORITY_LABEL, type RecPriority } from "@/lib/metrics/recommendations";
import type { RecWithStatus, RecStatus } from "@/server/analytics/recommendation-states";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";

const PRIORITY: Record<RecPriority, { icon: typeof Warning; cls: string; ring: string }> = {
  alta: { icon: WarningOctagon, cls: "text-critical", ring: "before:bg-critical" },
  media: { icon: Warning, cls: "text-warn", ring: "before:bg-warn" },
  baixa: { icon: Circle, cls: "text-ink-3", ring: "before:bg-line-strong" },
};

const STATUS_LABEL: Record<Exclude<RecStatus, "new">, string> = { reviewed: "Revisada", dismissed: "Dispensada", snoozed: "Lembrar depois" };

export function entityHref(r: RecWithStatus, ws: string, qs: string) {
  const join = qs ? `${qs}&` : "?";
  if (r.entity.type === "campaign" && r.entity.id) return `/w/${ws}/campanhas${join}c=${r.entity.id}`;
  if (r.entity.type === "ad" && r.entity.id) return `/w/${ws}/criativos${qs}#anuncio-${r.entity.id}`;
  if (r.entity.type === "funnel") return `/w/${ws}/funis${qs}`;
  if (r.rule === "define_targets" || r.category === "metas") return `/w/${ws}/configuracoes`;
  if (r.category === "rastreamento") return `/w/${ws}/metricas`;
  return null;
}

export function RecCard({
  rec,
  ws,
  accountId,
  qs,
  canEdit,
  periodLabel,
  comparisonLabel,
  generatedAt,
  onStatus,
  index = 0,
}: {
  rec: RecWithStatus;
  ws: string;
  accountId: string;
  qs: string;
  canEdit: boolean;
  periodLabel: string;
  comparisonLabel: string;
  generatedAt: string;
  onStatus?: (key: string, s: RecStatus) => void;
  index?: number;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<RecStatus>(rec.status);
  const [err, setErr] = useState(false);
  const [pending, start] = useTransition();
  const p = PRIORITY[rec.priority];
  const PIcon = p.icon;
  const href = entityHref(rec, ws, qs);

  const change = (s: "reviewed" | "dismissed" | "snoozed" | "reset") => {
    const prev = status;
    const next: RecStatus = s === "reset" ? "new" : s;
    setStatus(next);
    setErr(false);
    onStatus?.(rec.key, next);
    start(async () => {
      const r = await setRecommendationStatusAction(ws, accountId, rec.key, s).catch(() => ({ ok: false as const }));
      if (!r.ok) {
        setStatus(prev);
        onStatus?.(rec.key, prev);
        setErr(true);
      }
    });
  };

  return (
    <motion.article
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 30, delay: reduce ? 0 : index * 0.05 }}
      className={cn(
        "relative overflow-hidden rounded-[16px] border border-line bg-surface p-4 shadow-card before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full sm:p-5",
        p.ring,
        status !== "new" && "opacity-70",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-medium">
        <span className={cn("inline-flex items-center gap-1", p.cls)}>
          <PIcon size={13} weight="fill" aria-hidden /> Prioridade {PRIORITY_LABEL[rec.priority].toLowerCase()}
        </span>
        <span className="text-ink-3" aria-hidden>
          ·
        </span>
        <span className="text-ink-3">{CATEGORY_LABEL[rec.category]}</span>
        {rec.nature === "hipotese" ? <span className="rounded-full border border-line px-1.5 text-[11px] text-ink-3">hipótese</span> : null}
        {status !== "new" ? <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] text-ink-2">{STATUS_LABEL[status]}{status === "snoozed" && rec.statusUntil ? ` até ${fmtDate(rec.statusUntil.slice(0, 10))}` : ""}</span> : null}
      </div>

      <h3 className="mt-2 text-[15.5px] font-semibold tracking-[-0.01em] text-ink">{rec.title}</h3>
      {rec.entity.type !== "account" ? (
        href ? (
          <Link href={href} className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-[13px] text-ink-3 hover:text-accent-text hover:underline">
            <span className="truncate">{rec.entity.name}</span>
            <ArrowSquareOut size={12} className="shrink-0" aria-hidden />
          </Link>
        ) : (
          <p className="mt-0.5 truncate text-[13px] text-ink-3">{rec.entity.name}</p>
        )
      ) : null}

      <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-2">{rec.evidence}</p>
      <p className="mt-2 flex gap-2 text-[13.5px] leading-relaxed text-ink">
        <ArrowRight size={15} weight="bold" className="mt-[3px] shrink-0 text-accent-text" aria-hidden />
        <span>{rec.action}</span>
      </p>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-1 gap-y-2 border-t border-line pt-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[12.5px] font-medium text-accent-text hover:bg-accent-soft"
        >
          Ver análise <CaretDown size={12} weight="bold" className={cn("transition-transform duration-200", open && "rotate-180")} />
        </button>
        {canEdit ? (
          <div className="ml-auto flex items-center gap-0.5">
            {status === "new" ? (
              <>
                <IconBtn label="Marcar como revisada" onClick={() => change("reviewed")} disabled={pending}>
                  <Check size={15} weight="bold" />
                </IconBtn>
                <IconBtn label="Lembrar em 7 dias" onClick={() => change("snoozed")} disabled={pending}>
                  <Clock size={15} />
                </IconBtn>
                <IconBtn label="Dispensar" onClick={() => change("dismissed")} disabled={pending}>
                  <X size={15} />
                </IconBtn>
              </>
            ) : (
              <button type="button" onClick={() => change("reset")} disabled={pending} className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[12.5px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
                <ArrowCounterClockwise size={13} /> Desfazer
              </button>
            )}
          </div>
        ) : null}
        {err ? <p className="w-full text-[12px] text-critical">Não foi possível salvar. Tente de novo.</p> : null}
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="a"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-3 flex flex-col gap-3 rounded-[12px] bg-surface-2 p-3.5 text-[12.5px] leading-relaxed text-ink-2">
              {rec.analysis.metrics.length ? (
                <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
                  {rec.analysis.metrics.map((m) => (
                    <div key={m.label} className="contents">
                      <dt className="text-ink-3">{m.label}</dt>
                      <dd className="text-right tnum">
                        <span className="font-semibold text-ink">{m.value}</span>
                        {m.reference ? <span className="ml-1.5 text-ink-3">{m.reference}</span> : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <Block title={rec.nature === "hipotese" ? "Raciocínio (hipótese)" : "Raciocínio"} items={rec.analysis.reasoning} />
              <Block title="Critério" items={rec.analysis.thresholds} />
              <Block title="Limitações" items={rec.analysis.limitations} />
              <p className="text-ink-3">
                Período analisado: {periodLabel}
                {rec.analysis.comparison ? ` · comparado a ${comparisonLabel}` : ""} · gerada em {new Date(generatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}. Sugestão consultiva: nada é alterado na Meta.
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  );
}

function Block({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="font-medium text-ink">{title}</p>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} className="grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 transition-[background-color,color,transform] hover:bg-surface-2 hover:text-ink active:scale-[0.96] disabled:opacity-50">
      {children}
    </button>
  );
}
