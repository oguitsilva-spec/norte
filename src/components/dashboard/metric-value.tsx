"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { MetricValue } from "@/lib/metrics/core";
import { fmtValue, UNAVAILABLE_LABEL, UNAVAILABLE_HINT, type MetricFormat } from "@/lib/format";

/**
 * Número animado: interpola apenas quando o valor muda (0,6s) e sempre
 * termina no valor exato formatado. Com movimento reduzido, mostra direto.
 */
export function AnimatedNumber({ value, format, currency, compact }: { value: number; format: MetricFormat; currency: string; compact?: boolean }) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const prev = useRef<number | null>(null);
  useEffect(() => {
    // 1ª renderização: mostra o valor exato (igual ao HTML do servidor). Anima só nas trocas.
    if (prev.current === null || reduce) {
      prev.current = value;
      setDisplay(value);
      return;
    }
    const from = prev.current;
    prev.current = value;
    const c = animate(from, value, { duration: 0.6, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setDisplay(v) });
    return () => c.stop();
  }, [value, reduce]);
  const rounded = format === "number" && Number.isInteger(value) ? Math.round(display) : display;
  return <span aria-label={fmtValue(value, format, currency, { compact })}>{fmtValue(rounded, format, currency, { compact })}</span>;
}

export function MetricText({ m, format, currency, compact, animated }: { m: MetricValue; format: MetricFormat; currency: string; compact?: boolean; animated?: boolean }) {
  if (!m.ok)
    return (
      <Tooltip.Provider delayDuration={150}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <span tabIndex={0} className="cursor-help text-ink-3 underline decoration-dotted decoration-1 underline-offset-4">
              {UNAVAILABLE_LABEL[m.reason]}
            </span>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content sideOffset={6} className="z-50 max-w-[260px] rounded-[10px] border border-line bg-surface px-3 py-2 text-[12.5px] leading-relaxed text-ink-2 shadow-pop">
              {UNAVAILABLE_HINT[m.reason]}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
    );
  return animated ? <AnimatedNumber value={m.value} format={format} currency={currency} compact={compact} /> : <>{fmtValue(m.value, format, currency, { compact })}</>;
}
