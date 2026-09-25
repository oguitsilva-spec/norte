"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";
import { MagnifyingGlass, Columns, CaretUp, CaretDown, ArrowRight, X, Scales, DownloadSimple, Check } from "@phosphor-icons/react";
import type { ExplorerRow } from "@/server/analytics/dashboard";
import { delta, HIGHER_IS_BETTER, type KpiKey, type MetricValue } from "@/lib/metrics/core";
import { METRICS } from "@/lib/metrics/definitions";
import { RESULT_LABEL } from "@/lib/metrics/analysis";
import { fmtMetric, fmtNumber, fmtCurrency, fmtSignedPct, UNAVAILABLE_HINT, type MetricFormat } from "@/lib/format";
import { cn } from "@/lib/cn";

type ColKey = "name" | "status" | "objective" | "spend" | "results" | "cpr" | "purchases" | "purchaseValue" | "roas" | "costPerPurchase" | "impressions" | "linkClicks" | "ctr" | "cpc" | "cpm" | "leads" | "costPerLead" | "messagingConversations" | "landingPageViews";

const COLS: Array<{ key: ColKey; label: string; format?: MetricFormat; align?: "right"; default?: boolean }> = [
  { key: "status", label: "Status", default: true },
  { key: "objective", label: "Objetivo", default: true },
  { key: "spend", label: "Investimento", format: "currency", align: "right", default: true },
  { key: "results", label: "Resultados", format: "number", align: "right", default: true },
  { key: "cpr", label: "Custo por resultado", format: "currency", align: "right", default: true },
  { key: "purchases", label: "Compras", format: "number", align: "right", default: true },
  { key: "purchaseValue", label: "Receita atribuída", format: "currency", align: "right", default: true },
  { key: "roas", label: "ROAS", format: "roas", align: "right", default: true },
  { key: "costPerPurchase", label: "Custo por compra", format: "currency", align: "right", default: false },
  { key: "impressions", label: "Impressões", format: "number", align: "right" },
  { key: "linkClicks", label: "Cliques no link", format: "number", align: "right" },
  { key: "ctr", label: "CTR (link)", format: "pct", align: "right", default: true },
  { key: "cpc", label: "CPC (link)", format: "currency", align: "right" },
  { key: "cpm", label: "CPM", format: "currency", align: "right" },
  { key: "landingPageViews", label: "Visualizações da página", format: "number", align: "right" },
  { key: "leads", label: "Leads", format: "number", align: "right" },
  { key: "costPerLead", label: "Custo por lead", format: "currency", align: "right" },
  { key: "messagingConversations", label: "Conversas", format: "number", align: "right" },
];

const STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "Ativo", cls: "bg-good-soft text-good" },
  PAUSED: { label: "Pausado", cls: "bg-surface-2 text-ink-2" },
  CAMPAIGN_PAUSED: { label: "Campanha pausada", cls: "bg-surface-2 text-ink-2" },
  ADSET_PAUSED: { label: "Conjunto pausado", cls: "bg-surface-2 text-ink-2" },
  ARCHIVED: { label: "Arquivado", cls: "bg-surface-2 text-ink-3" },
  DELETED: { label: "Excluído", cls: "bg-surface-2 text-ink-3" },
  WITH_ISSUES: { label: "Com problemas", cls: "bg-serious-soft text-serious" },
  DISAPPROVED: { label: "Reprovado", cls: "bg-critical-soft text-critical" },
  PENDING_REVIEW: { label: "Em análise", cls: "bg-warn-soft text-warn" },
  IN_PROCESS: { label: "Em processamento", cls: "bg-warn-soft text-warn" },
};

function valueOf(r: ExplorerRow, key: ColKey): MetricValue | string | null {
  switch (key) {
    case "name":
      return r.name;
    case "status":
      return r.status ?? "";
    case "objective":
      return r.groupLabel ?? "";
    case "results":
      return { ok: true, value: r.results };
    case "cpr":
      return r.cpr;
    default:
      return r.kpis[key as KpiKey];
  }
}
function prevOf(r: ExplorerRow, key: ColKey): MetricValue | null {
  if (key === "name" || key === "status" || key === "objective" || key === "results" || key === "cpr") return null;
  return r.prevKpis[key as KpiKey];
}
const sortNum = (v: MetricValue | string | null) => (v && typeof v === "object" ? (v.ok ? v.value : -Infinity) : 0);

export function ExplorerTable({
  rows,
  currency,
  level,
  ws,
  qs,
  exportHref,
}: {
  rows: ExplorerRow[];
  currency: string;
  level: "campaign" | "adset" | "ad";
  ws: string;
  qs: string;
  exportHref: string;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [sort, setSort] = useState<{ key: ColKey; dir: "asc" | "desc" }>({ key: "spend", dir: "desc" });
  const [cols, setCols] = useState<Set<ColKey>>(() => new Set(COLS.filter((c) => c.default && !(c.key === "objective" && level !== "campaign")).map((c) => c.key)));
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<ExplorerRow | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("pt-BR");
    const out = rows.filter((r) => (!needle || r.name.toLocaleLowerCase("pt-BR").includes(needle)) && (status === "all" || (status === "active" ? r.status === "ACTIVE" : r.status !== "ACTIVE")));
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      const va = valueOf(a, sort.key);
      const vb = valueOf(b, sort.key);
      if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb), "pt-BR") * dir;
      return (sortNum(va) - sortNum(vb)) * dir;
    });
  }, [rows, q, status, sort]);

  const visibleCols = COLS.filter((c) => cols.has(c.key));
  const childHref = (r: ExplorerRow) => {
    const p = new URLSearchParams(qs.replace(/^\?/, ""));
    if (level === "campaign") p.set("c", r.id);
    else if (level === "adset") p.set("cj", r.id);
    return `/w/${ws}/campanhas?${p}`;
  };
  const toggleSel = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 4 ? s : [...s, id]));
  const compareRows = rows.filter((r) => selected.includes(r.id));
  const levelLabel = level === "campaign" ? "campanhas" : level === "adset" ? "conjuntos" : "anúncios";

  const cell = (r: ExplorerRow, c: (typeof COLS)[number]) => {
    const v = valueOf(r, c.key);
    if (c.key === "status") {
      const s = STATUS[String(v)] ?? { label: String(v || "n/d"), cls: "bg-surface-2 text-ink-2" };
      return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium", s.cls)}>{s.label}</span>;
    }
    if (c.key === "objective") return <span className="text-ink-2">{String(v)}</span>;
    const m = v as MetricValue;
    const salesCol = c.key === "purchases" || c.key === "purchaseValue" || c.key === "roas" || c.key === "costPerPurchase";
    if (salesCol && r.group && r.group !== "sales" && r.totals.purchases === 0)
      return <span className="text-[12px] text-ink-3" title="Campanha sem objetivo de vendas e sem compras atribuídas">não se aplica</span>;
    if (c.key === "results") return <span title={RESULT_LABEL[r.resultKind].plural}>{fmtNumber(r.results)}</span>;
    if (!m.ok) return <span className="text-ink-3" title={UNAVAILABLE_HINT[m.reason]}>{fmtMetric(m, c.format ?? "number", currency)}</span>;
    const p = prevOf(r, c.key);
    const d = p ? delta(m, p) : null;
    const hib = c.key in HIGHER_IS_BETTER ? HIGHER_IS_BETTER[c.key as KpiKey] : null;
    return (
      <span className="inline-flex flex-col items-end leading-tight">
        <span>{fmtMetric(m, c.format ?? "number", currency)}</span>
        {d && d.ok && d.pct !== null && Math.abs(d.pct) >= 0.5 ? (
          <span className={cn("text-[11px] font-medium", hib === null ? "text-ink-3" : (d.pct > 0) === hib ? "text-good" : "text-critical")}>{fmtSignedPct(d.pct, 0)}</span>
        ) : null}
      </span>
    );
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3 pt-4">
        <label className="relative flex min-w-[220px] flex-1 items-center sm:max-w-[320px]">
          <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 text-ink-3" />
          <span className="sr-only">Buscar {levelLabel}</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar ${levelLabel}`} className="h-9 w-full rounded-[10px] border border-line-strong bg-surface pl-9 pr-3 text-[13.5px] text-ink placeholder:text-ink-3 focus:border-accent focus:shadow-[var(--ring)] focus:outline-none" />
        </label>
        <div role="radiogroup" aria-label="Status" className="inline-flex rounded-[10px] border border-line bg-surface-2 p-0.5">
          {(
            [
              ["all", "Todos"],
              ["active", "Ativos"],
              ["inactive", "Inativos"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={status === k} onClick={() => setStatus(k)} className={cn("rounded-[8px] px-2.5 py-1 text-[12.5px] font-medium text-ink-2", status === k && "bg-surface text-ink shadow-card")}>
              {l}
            </button>
          ))}
        </div>
        <Popover.Root>
          <Popover.Trigger className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:border-line-strong">
            <Columns size={16} /> Colunas
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="end" sideOffset={6} className="z-50 max-h-[360px] w-[240px] overflow-y-auto rounded-[12px] border border-line bg-surface p-1.5 shadow-pop scrollbar-thin">
              {COLS.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-[13px] text-ink hover:bg-surface-2">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--accent)]" checked={cols.has(c.key)} onChange={() => setCols((s) => { const n = new Set(s); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} />
                  {c.label}
                </label>
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <a href={exportHref} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:border-line-strong">
          <DownloadSimple size={16} /> Exportar CSV
        </a>
        {selected.length >= 2 ? (
          <Dialog.Root>
            <Dialog.Trigger className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-accent px-3 text-[13px] font-medium text-accent-ink hover:bg-accent-hover">
              <Scales size={16} /> Comparar {selected.length}
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[min(96vw,900px)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[16px] border border-line bg-surface p-6 shadow-pop">
                <Dialog.Title className="text-[17px] font-semibold text-ink">Comparação lado a lado</Dialog.Title>
                <Dialog.Description className="mt-1 text-[13px] text-ink-3">Mesmo período e mesma atribuição. Razões calculadas a partir dos totais de cada linha.</Dialog.Description>
                <Dialog.Close aria-label="Fechar" className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 hover:bg-surface-2">
                  <X size={16} />
                </Dialog.Close>
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-[13px]">
                    <thead>
                      <tr>
                        <th className="py-2 pr-3 text-left font-medium text-ink-3">Métrica</th>
                        {compareRows.map((r) => (
                          <th key={r.id} className="max-w-[180px] px-3 py-2 text-right font-semibold text-ink">
                            <span className="line-clamp-2">{r.name}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {COLS.filter((c) => c.format).map((c) => {
                        const vals = compareRows.map((r) => valueOf(r, c.key) as MetricValue);
                        const nums = vals.filter((v) => v.ok).map((v) => (v as { value: number }).value);
                        const hib = c.key in HIGHER_IS_BETTER ? HIGHER_IS_BETTER[c.key as KpiKey] : null;
                        const best = hib === null || nums.length < 2 ? null : hib ? Math.max(...nums) : Math.min(...nums);
                        return (
                          <tr key={c.key} className="border-t border-line">
                            <td className="py-2 pr-3 text-ink-2">{c.label}</td>
                            {vals.map((v, i) => (
                              <td key={i} className={cn("px-3 py-2 text-right tnum", v.ok && v.value === best ? "font-semibold text-ink" : "text-ink-2")}>
                                {c.key === "results" ? fmtNumber(compareRows[i].results) : fmtMetric(v, c.format!, currency)}
                                {v.ok && v.value === best ? <Check size={12} weight="bold" className="ml-1 inline text-good" aria-label="melhor" /> : null}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        ) : selected.length === 1 ? (
          <span className="text-[12.5px] text-ink-3">Selecione mais uma linha para comparar (até 4).</span>
        ) : null}
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-[13px]">
          <caption className="sr-only">Tabela de {levelLabel} com métricas do período e variação vs período anterior</caption>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-10 border-y border-line bg-surface-2 px-3 py-2.5">
                <span className="sr-only">Selecionar</span>
              </th>
              <th className="sticky left-10 z-10 min-w-[260px] border-y border-line bg-surface-2 px-3 py-2.5 text-left">
                <SortBtn label="Nome" active={sort.key === "name"} dir={sort.dir} onClick={() => setSort((s) => ({ key: "name", dir: s.key === "name" && s.dir === "asc" ? "desc" : "asc" }))} />
              </th>
              {visibleCols.map((c) => (
                <th key={c.key} className={cn("whitespace-nowrap border-y border-line bg-surface-2 px-3 py-2.5 font-medium", c.align === "right" ? "text-right" : "text-left")} aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                  <SortBtn label={c.label} active={sort.key === c.key} dir={sort.dir} align={c.align} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === "desc" ? "asc" : "desc" }))} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className={cn("group", selected.includes(r.id) && "bg-accent-soft/50")}>
                <td className="sticky left-0 z-[1] border-b border-line bg-surface px-3 py-2.5 group-hover:bg-surface-2">
                  <input type="checkbox" aria-label={`Selecionar ${r.name} para comparação`} checked={selected.includes(r.id)} onChange={() => toggleSel(r.id)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
                </td>
                <td className="sticky left-10 z-[1] border-b border-line bg-surface px-3 py-2.5 group-hover:bg-surface-2">
                  <div className="flex items-center gap-2.5">
                    {level === "ad" ? (
                      <span className="h-9 w-9 shrink-0 overflow-hidden rounded-[8px] bg-surface-2 ring-1 ring-line">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {r.thumbnailUrl ? <img src={r.thumbnailUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : null}
                      </span>
                    ) : null}
                    <div className="min-w-0">
                      {level !== "ad" ? (
                        <Link href={childHref(r)} className="line-clamp-2 font-medium text-ink hover:text-accent-text hover:underline">
                          {r.name}
                        </Link>
                      ) : (
                        <span className="line-clamp-2 font-medium text-ink">{r.name}</span>
                      )}
                      <button onClick={() => setDetail(r)} className="text-[12px] text-ink-3 hover:text-accent-text">
                        Detalhes
                      </button>
                    </div>
                  </div>
                </td>
                {visibleCols.map((c) => (
                  <td key={c.key} className={cn("whitespace-nowrap border-b border-line px-3 py-2.5 text-ink tnum group-hover:bg-surface-2", c.align === "right" ? "text-right" : "text-left")}>
                    {cell(r, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 ? <p className="px-5 py-10 text-center text-[13.5px] text-ink-3">{rows.length ? "Nenhum resultado para esta busca." : `Nenhum(a) ${levelLabel.slice(0, -1)} com entrega no período.`}</p> : null}
      </div>

      <Dialog.Root open={Boolean(detail)} onOpenChange={(o) => !o && setDetail(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
          <Dialog.Content className="fixed inset-y-0 right-0 z-50 w-[min(100vw,440px)] overflow-y-auto border-l border-line bg-surface p-6 shadow-pop">
            {detail ? (
              <>
                <Dialog.Title className="pr-8 text-[17px] font-semibold leading-snug text-ink">{detail.name}</Dialog.Title>
                <Dialog.Description className="mt-1 text-[13px] text-ink-3">
                  {detail.parentName ? `${detail.parentName} · ` : ""}Período atual vs anterior
                </Dialog.Description>
                <Dialog.Close aria-label="Fechar" className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 hover:bg-surface-2">
                  <X size={16} />
                </Dialog.Close>
                <dl className="mt-5 divide-y divide-line">
                  {(Object.keys(METRICS) as KpiKey[]).map((k) => {
                    const cur = detail.kpis[k];
                    const prev = detail.prevKpis[k];
                    const d = delta(cur, prev);
                    const hib = HIGHER_IS_BETTER[k];
                    return (
                      <div key={k} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 py-2.5 text-[13px]">
                        <dt className="text-ink-2">{METRICS[k].label}</dt>
                        <dd className="text-right font-semibold text-ink tnum">{fmtMetric(cur, METRICS[k].format, currency)}</dd>
                        <dd className={cn("w-16 text-right text-[12px] tnum", d.ok && d.pct !== null && hib !== null ? ((d.pct > 0) === hib ? "text-good" : "text-critical") : "text-ink-3")}>{d.ok && d.pct !== null ? fmtSignedPct(d.pct, 0) : "n/d"}</dd>
                      </div>
                    );
                  })}
                </dl>
                {level !== "ad" ? (
                  <Link href={childHref(detail)} className="mt-5 inline-flex items-center gap-1 text-[13.5px] font-medium text-accent-text hover:underline">
                    Abrir {level === "campaign" ? "conjuntos de anúncios" : "anúncios"} <ArrowRight size={14} />
                  </Link>
                ) : null}
                <p className="mt-4 text-[12px] text-ink-3">Investimento anterior: {fmtCurrency(detail.prevTotals.spend, currency)}</p>
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function SortBtn({ label, active, dir, onClick, align }: { label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void; align?: "right" }) {
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-1 text-[12px] font-medium", active ? "text-ink" : "text-ink-3 hover:text-ink", align === "right" && "flex-row-reverse")}>
      {label}
      {active ? dir === "desc" ? <CaretDown size={12} weight="bold" /> : <CaretUp size={12} weight="bold" /> : null}
    </button>
  );
}
