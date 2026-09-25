import { cn } from "@/lib/cn";

/** Marca: um "N" geométrico com seta ao norte - marca própria, simples. */
export function Logo({ className, withWord = true }: { className?: string; withWord?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-ink", className)}>
      <svg viewBox="0 0 28 28" className="h-7 w-7" aria-hidden>
        <rect width="28" height="28" rx="8" fill="var(--accent)" />
        <path d="M8.5 20V8.5l11 11V8" stroke="var(--accent-ink)" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17 10.5 19.5 8l2.5 2.5" stroke="var(--accent-ink)" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity=".75" />
      </svg>
      {withWord ? <span className="text-[17px] font-semibold tracking-[-0.02em]">Norte</span> : null}
    </span>
  );
}
