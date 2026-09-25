"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ArrowsClockwise, CheckCircle, WarningCircle, CircleNotch, Flask } from "@phosphor-icons/react";
import { refreshNowAction } from "@/server/actions/workspace";
import { fmtRelative, fmtDateTime, fmtDate } from "@/lib/format";
import type { Freshness } from "@/server/analytics/dashboard";
import { cn } from "@/lib/cn";

type Props = { ws: string; accountId: string; timezone: string; freshness: Freshness; isDemo: boolean };

export function SyncStatus({ ws, accountId, timezone, freshness, isDemo }: Props) {
  const router = useRouter();
  const [, force] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [running, setRunning] = useState(freshness.syncStatus === "initial_sync" || freshness.syncProgress !== null);
  const [progress, setProgress] = useState<number | null>(freshness.syncProgress);
  const lastSeen = useRef(freshness.lastSuccessfulSyncAt);

  // Relógio relativo ("há 4 min") sem recarregar a página.
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Polling leve: detecta nova sincronização concluída e atualiza o painel.
  useEffect(() => {
    if (isDemo) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/w/${ws}/status?conta=${accountId}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        const a = j.accounts?.[0];
        if (!a || stop) return;
        const isRunning = a.lastRun?.status === "running" || a.lastRun?.status === "queued" || a.syncStatus === "initial_sync";
        setRunning(isRunning);
        setProgress(a.progress);
        if (a.lastSuccessfulSyncAt && a.lastSuccessfulSyncAt !== lastSeen.current) {
          lastSeen.current = a.lastSuccessfulSyncAt;
          router.refresh();
        }
      } catch {}
    };
    const id = setInterval(tick, running ? 4_000 : 30_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [ws, accountId, isDemo, running, router]);

  const last = freshness.lastSuccessfulSyncAt;
  const tone = isDemo ? "demo" : running ? "running" : freshness.stale || freshness.syncStatus === "error" ? "stale" : "ok";

  return (
    <Tooltip.Provider delayDuration={200}>
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <div tabIndex={0} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[13px] text-ink-2">
              {tone === "demo" ? <Flask size={16} className="text-warn" /> : tone === "running" ? <CircleNotch size={16} className="animate-spin text-accent-text" /> : tone === "stale" ? <WarningCircle size={16} weight="fill" className="text-serious" /> : <CheckCircle size={16} weight="fill" className="text-good" />}
              <span>
                {tone === "running"
                  ? `Sincronizando${progress !== null && progress !== undefined ? ` ${Math.round(progress * 100)}%` : "…"}`
                  : last
                    ? <>Última sincronização <span className="font-medium text-ink">{fmtRelative(last)}</span></>
                    : "Aguardando primeira sincronização"}
              </span>
            </div>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content side="bottom" align="end" sideOffset={6} className="z-50 max-w-[320px] rounded-[10px] border border-line bg-surface px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2 shadow-pop">
              {isDemo ? <p className="mb-1.5 font-medium text-warn">Modo demonstração: horários e dados são fictícios.</p> : null}
              <p>
                <span className="text-ink-3">Dados da Meta sincronizados em: </span>
                <span className="font-medium text-ink">{last ? fmtDateTime(last, timezone) : "ainda não"}</span>
              </p>
              {freshness.dataThrough ? (
                <p>
                  <span className="text-ink-3">Cobertura: </span>
                  <span className="font-medium text-ink">{freshness.dataFrom ? `${fmtDate(freshness.dataFrom)} a ${fmtDate(freshness.dataThrough)}` : fmtDate(freshness.dataThrough)}</span>
                </p>
              ) : null}
              <p>
                <span className="text-ink-3">Painel gerado em: </span>
                <span className="font-medium text-ink">{fmtDateTime(freshness.generatedAt, timezone)}</span>
              </p>
              <p className="mt-1.5 text-ink-3">
                Sincronização automática a cada {freshness.intervalMinutes} min. A Meta pode levar horas para consolidar conversões; os últimos dias são reprocessados a cada sincronização.
              </p>
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <button
          disabled={pending || running}
          onClick={() =>
            start(async () => {
              const r = await refreshNowAction(ws, accountId);
              setMsg(r.message ?? null);
              if (r.ok) setRunning(true);
              setTimeout(() => setMsg(null), 6000);
            })
          }
          title={isDemo ? "Indisponível no modo demonstração" : "Pedir uma sincronização agora"}
          className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-medium text-ink transition-colors hover:border-line-strong active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-55"
        >
          <ArrowsClockwise size={16} className={cn(pending && "animate-spin")} />
          Atualizar agora
        </button>
        <span aria-live="polite" className="text-[12.5px] text-ink-2">
          {msg}
        </span>
      </div>
    </Tooltip.Provider>
  );
}
