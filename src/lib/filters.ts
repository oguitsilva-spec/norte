import { resolvePreset, previousPeriod, daysBetweenInclusive, type DatePreset } from "@/lib/metrics/core";
import type { ObjectiveGroup } from "@/lib/metrics/actions";

/**
 * Filtros globais - vivem na URL (?conta=&periodo=&de=&ate=&campanha=&objetivo=)
 * para serem compartilháveis e consistentes entre as telas.
 */
export type ViewFilters = {
  account: string | null;
  preset: DatePreset;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  campaign: string | null;
  objective: ObjectiveGroup | null;
  includesToday: boolean;
};

export const PRESET_LABEL: Record<DatePreset, string> = {
  today: "Hoje (parcial)",
  "7d": "Últimos 7 dias",
  "14d": "Últimos 14 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
  mtd: "Este mês",
  last_month: "Mês passado",
  custom: "Personalizado",
};

const PRESETS = new Set<DatePreset>(["today", "7d", "14d", "30d", "90d", "mtd", "last_month", "custom"]);
const OBJECTIVES = new Set<ObjectiveGroup>(["sales", "leads", "messaging", "awareness", "traffic", "engagement", "app", "other"]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export function parseFilters(sp: SP, today: string): ViewFilters {
  let preset = (one(sp.periodo) as DatePreset) ?? "30d";
  if (!PRESETS.has(preset)) preset = "30d";
  let range: { from: string; to: string };
  const de = one(sp.de);
  const ate = one(sp.ate);
  if (preset === "custom" && de && ate && ISO.test(de) && ISO.test(ate) && de <= ate && ate <= today && daysBetweenInclusive(de, ate) <= 400) {
    range = { from: de, to: ate };
  } else {
    if (preset === "custom") preset = "30d";
    range = resolvePreset(preset, today);
  }
  const prev = previousPeriod(range.from, range.to);
  const objective = one(sp.objetivo) as ObjectiveGroup | null;
  return {
    account: one(sp.conta),
    preset,
    from: range.from,
    to: range.to,
    prevFrom: prev.from,
    prevTo: prev.to,
    campaign: one(sp.campanha),
    objective: objective && OBJECTIVES.has(objective) ? objective : null,
    includesToday: range.to >= today,
  };
}

/** Serializa de volta para querystring, preservando apenas o que importa. */
export function filtersToQuery(f: Partial<ViewFilters>, overrides: Record<string, string | null | undefined> = {}) {
  const p = new URLSearchParams();
  if (f.account) p.set("conta", f.account);
  if (f.preset) p.set("periodo", f.preset);
  if (f.preset === "custom" && f.from && f.to) {
    p.set("de", f.from);
    p.set("ate", f.to);
  }
  if (f.campaign) p.set("campanha", f.campaign);
  if (f.objective) p.set("objetivo", f.objective);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null || v === undefined || v === "") p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}
