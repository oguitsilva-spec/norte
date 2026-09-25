"use client";
import * as Popover from "@radix-ui/react-popover";
import { Info } from "@phosphor-icons/react";

/** Popover com fórmula, fonte, agregação e atribuição de uma métrica. */
export function MetricInfo({ label, formula, source, aggregation, attribution }: { label: string; formula: string; source: string; aggregation: string; attribution?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger aria-label={`Como ${label} é calculado`} className="grid h-5 w-5 place-items-center rounded-full text-ink-3 transition-colors hover:text-ink">
        <Info size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} align="start" className="z-50 w-[300px] rounded-[12px] border border-line bg-surface p-3.5 text-[12.5px] leading-relaxed text-ink-2 shadow-pop">
          <p className="text-[13px] font-semibold text-ink">{label}</p>
          <dl className="mt-2 flex flex-col gap-1.5">
            <div>
              <dt className="text-ink-3">Fórmula</dt>
              <dd className="font-medium text-ink">{formula}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Fonte</dt>
              <dd>{source}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Agregação</dt>
              <dd>{aggregation}</dd>
            </div>
            {attribution ? (
              <div>
                <dt className="text-ink-3">Atribuição</dt>
                <dd>{attribution}</dd>
              </div>
            ) : null}
          </dl>
          <Popover.Arrow className="fill-[var(--surface)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
