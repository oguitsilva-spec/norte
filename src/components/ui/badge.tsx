import { cn } from "@/lib/cn";

type Tone = "neutral" | "accent" | "good" | "warn" | "serious" | "critical";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 border-line",
  accent: "bg-accent-soft text-accent-text border-transparent",
  good: "bg-good-soft text-good border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  serious: "bg-serious-soft text-serious border-transparent",
  critical: "bg-critical-soft text-critical border-transparent",
};

export function Badge({ tone = "neutral", className, children, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium leading-5 whitespace-nowrap", tones[tone], className)} {...p}>
      {children}
    </span>
  );
}
