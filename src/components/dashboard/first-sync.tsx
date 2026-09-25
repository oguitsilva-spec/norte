"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { CheckCircle, CircleNotch, Circle, WarningCircle } from "@phosphor-icons/react";

type Status = {
  progress: number | null;
  syncStatus: string;
  initialDone: boolean;
  error: string | null;
  errorCode?: string | null;
  lastRun: { status: string; createdAt?: string } | null;
};

const STEPS = [
  { at: 0.05, label: "Conta e moeda confirmadas" },
  { at: 0.15, label: "Campanhas, conjuntos e anúncios" },
  { at: 0.75, label: "Métricas diárias por anúncio" },
  { at: 0.85, label: "Plataformas e posicionamentos" },
  { at: 1, label: "Alcance por período" },
];

export function FirstSyncProgress({ ws, accountId }: { ws: string; accountId: string }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/w/${ws}/status?conta=${accountId}`, { cache: "no-store" });
        const j = await r.json();
        const a = j.accounts?.[0];
        if (!alive || !a) return;
        setS(a);
        if (a.initialDone) router.refresh();
      } catch {}
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [ws, accountId, router]);

  const p = s?.progress ?? 0;
  const runStatus = s?.lastRun?.status;
  // Após uma falha temporária a execução volta para a fila (nova tentativa); o erro continua visível.
  const failed = Boolean(s && !s.initialDone && s.error && runStatus !== "running");
  const retrying = failed && runStatus === "queued";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  const queuedMin = runStatus === "queued" && s?.lastRun?.createdAt ? (now - new Date(s.lastRun.createdAt).getTime()) / 60_000 : 0;
  const stuck = !failed && runStatus === "queued" && queuedMin >= 3;
  return (
    <div className="mt-4 w-full rounded-[14px] border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between text-[13px]">
        <span className="font-medium text-ink">{retrying ? "Nova tentativa agendada" : failed ? "Tentativa com erro" : runStatus === "queued" || !s ? "Na fila" : "Sincronizando"}</span>
        <span className="text-ink-2 tnum">{Math.round(p * 100)}%</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-[4px] bg-accent-soft" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)} aria-label="Progresso da primeira sincronização">
        <motion.div className="h-2 rounded-[4px] bg-accent" initial={false} animate={{ width: `${Math.max(3, p * 100)}%` }} transition={{ duration: reduce ? 0 : 0.5, ease: "easeOut" }} />
      </div>
      <ul className="mt-4 flex flex-col gap-2 text-[13.5px]">
        {STEPS.map((st, i) => {
          const done = p >= st.at;
          const current = !done && (i === 0 || p >= STEPS[i - 1].at);
          return (
            <li key={st.label} className="flex items-center gap-2.5">
              {done ? <CheckCircle size={18} weight="fill" className="text-good" /> : current && !failed ? <CircleNotch size={18} className="animate-spin text-accent-text" /> : <Circle size={18} className="text-ink-3" />}
              <span className={done ? "text-ink" : "text-ink-2"}>{st.label}</span>
            </li>
          );
        })}
      </ul>
      {failed && s?.error ? (
        <p className="mt-4 flex gap-2 rounded-[10px] bg-warn-soft px-3 py-2.5 text-[13px] text-ink">
          <WarningCircle size={18} weight="fill" className="shrink-0 text-warn" />
          <span>
            {s.error}
            {s.errorCode ? <span className="text-ink-3"> (código: {s.errorCode})</span> : null}
          </span>
        </p>
      ) : null}
      {stuck ? (
        <p className="mt-4 flex gap-2 rounded-[10px] bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2">
          <WarningCircle size={18} weight="fill" className="shrink-0 text-ink-3" />
          Na fila há {Math.floor(queuedMin)} minutos sem começar. O processo de sincronização (worker) pode estar parado; verifique se ele está ativo na hospedagem.
        </p>
      ) : null}
    </div>
  );
}
