"use client";
import * as Popover from "@radix-ui/react-popover";
import { Info } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

/** Explicação curta sob demanda (substitui parágrafos fixos na tela). */
export function Hint({ label, children, className, align = "start" }: { label: string; children: React.ReactNode; className?: string; align?: "start" | "center" | "end" }) {
  return (
    <Popover.Root>
      <Popover.Trigger aria-label={label} className={cn("inline-grid h-5 w-5 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:text-ink focus-visible:text-ink", className)}>
        <Info size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} align={align} collisionPadding={12} className="z-50 w-[min(320px,calc(100vw-24px))] rounded-[12px] border border-line bg-surface p-3.5 text-[12.5px] leading-relaxed text-ink-2 shadow-pop data-[state=open]:animate-[pop-in_160ms_cubic-bezier(0.16,1,0.3,1)]">
          {children}
          <Popover.Arrow className="fill-[var(--surface)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
