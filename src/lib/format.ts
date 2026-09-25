import type { MetricValue } from "@/lib/metrics/core";

/** Formatação pt-BR. A moeda é SEMPRE a da conta de anúncios. */

const cache = new Map<string, Intl.NumberFormat>();
function nf(key: string, opts: Intl.NumberFormatOptions) {
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("pt-BR", opts);
    cache.set(key, f);
  }
  return f;
}

export function fmtCurrency(v: number, currency: string, opts: { compact?: boolean; decimals?: number } = {}) {
  if (opts.compact && Math.abs(v) >= 10_000) {
    return nf(`cc-${currency}`, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(v);
  }
  const d = opts.decimals ?? 2;
  return nf(`c-${currency}-${d}`, { style: "currency", currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
}

export function fmtNumber(v: number, decimals = 0) {
  return nf(`n-${decimals}`, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
}

export function fmtCompact(v: number) {
  if (Math.abs(v) < 10_000) return fmtNumber(v);
  return nf("compact", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

export function fmtPct(v: number, decimals = 1) {
  return `${fmtNumber(v, decimals)}%`;
}

/** ROAS é uma razão (x), NÃO uma moeda nem um percentual. */
export function fmtRoas(v: number) {
  return `${fmtNumber(v, 2)}×`;
}

export function fmtSignedPct(v: number, decimals = 1) {
  const s = fmtNumber(Math.abs(v), decimals);
  return v > 0 ? `+${s}%` : v < 0 ? `−${s}%` : `${s}%`;
}

export const UNAVAILABLE_LABEL: Record<string, string> = {
  no_data: "Sem dados",
  zero_denominator: "n/d",
  not_tracked: "Não rastreado",
};

export const UNAVAILABLE_HINT: Record<string, string> = {
  no_data: "Não há dados sincronizados para este período.",
  zero_denominator: "Não calculável: o denominador é zero (ex.: nenhuma compra ou nenhum gasto no período).",
  not_tracked: "Esta conta não registrou este evento. Verifique o pixel/API de Conversões e o evento configurado.",
};

export type MetricFormat = "currency" | "number" | "roas" | "pct" | "decimal";

export function fmtMetric(m: MetricValue, format: MetricFormat, currency: string, opts: { compact?: boolean } = {}) {
  if (!m.ok) return UNAVAILABLE_LABEL[m.reason];
  return fmtValue(m.value, format, currency, opts);
}

export function fmtValue(v: number, format: MetricFormat, currency: string, opts: { compact?: boolean } = {}) {
  switch (format) {
    case "currency":
      return fmtCurrency(v, currency, { compact: opts.compact });
    case "roas":
      return fmtRoas(v);
    case "pct":
      return fmtPct(v, 2);
    case "decimal":
      return fmtNumber(v, 2);
    default:
      return opts.compact ? fmtCompact(v) : fmtNumber(v, Number.isInteger(v) ? 0 : 1);
  }
}

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const shortDateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" });

/** Datas "YYYY-MM-DD" (já no fuso da conta) → dd/mm/aaaa. */
export function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return dateFmt.format(new Date(Date.UTC(y, m - 1, d)));
}
export function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return shortDateFmt.format(new Date(Date.UTC(y, m - 1, d))).replace(".", "");
}
export function fmtRange(from: string, to: string) {
  return from === to ? fmtDate(from) : `${fmtDate(from)} a ${fmtDate(to)}`;
}

/** Instante (timestamp) exibido no fuso indicado, com o nome do fuso. */
export function fmtDateTime(d: Date | string, timeZone: string) {
  const dt = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(dt);
}

export function fmtRelative(d: Date | string, now: Date = new Date()) {
  const dt = typeof d === "string" ? new Date(d) : d;
  const s = Math.round((now.getTime() - dt.getTime()) / 1000);
  if (s < 45) return "agora mesmo";
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.round(h / 24);
  return days === 1 ? "há 1 dia" : `há ${days} dias`;
}

export function timezoneLabel(tz: string) {
  try {
    const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date());
    const off = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    return `${tz.replace(/_/g, " ")} (${off})`;
  } catch {
    return tz;
  }
}
