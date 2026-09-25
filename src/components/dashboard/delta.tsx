import { ArrowUpRight, ArrowDownRight, Minus } from "@phosphor-icons/react/ssr";
import type { Delta as D } from "@/lib/metrics/core";
import { fmtSignedPct } from "@/lib/format";
import { cn } from "@/lib/cn";

/** Variação vs período anterior. Cor = direção × "subir é bom?". Sempre com ícone e texto. */
export function Delta({ d, higherIsBetter, className }: { d: D; higherIsBetter: boolean | null; className?: string }) {
  if (!d.ok) return <span className={cn("text-[12.5px] text-ink-3", className)}>sem comparação</span>;
  if (d.pct === null) return <span className={cn("text-[12.5px] text-ink-3", className)}>base anterior zero</span>;
  const flat = Math.abs(d.pct) < 0.5;
  const up = d.pct > 0;
  const good = higherIsBetter === null || flat ? null : up === higherIsBetter;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[12.5px] font-medium tnum", good === null ? "text-ink-2" : good ? "text-good" : "text-critical", className)}>
      <Icon size={14} weight="bold" aria-hidden />
      {fmtSignedPct(d.pct)}
      <span className="sr-only">{good === null ? "" : good ? "(melhora)" : "(piora)"}</span>
    </span>
  );
}
