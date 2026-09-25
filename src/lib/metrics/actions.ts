/**
 * Mapeamento de action_types da Meta para as métricas do produto.
 *
 * A Meta devolve VÁRIOS action_types que representam o MESMO evento sob
 * óticas diferentes (ex.: `omni_purchase` já consolida `purchase`,
 * `offsite_conversion.fb_pixel_purchase`, `onsite_web_purchase`…). Somá-los
 * contaria a mesma compra várias vezes. Por isso escolhemos UM tipo canônico
 * por conta (o de maior prioridade que aparece nos dados) e usamos só ele.
 */

export type ActionMetric =
  | "purchase"
  | "lead"
  | "messaging"
  | "landing_page_view"
  | "add_to_cart"
  | "initiate_checkout";

export const ACTION_PRIORITY: Record<ActionMetric, string[]> = {
  purchase: [
    "omni_purchase",
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "onsite_web_purchase",
    "onsite_conversion.purchase",
    "app_custom_event.fb_mobile_purchase",
  ],
  lead: ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead"],
  messaging: ["onsite_conversion.messaging_conversation_started_7d"],
  landing_page_view: ["omni_landing_page_view", "landing_page_view"],
  add_to_cart: ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"],
  initiate_checkout: [
    "omni_initiated_checkout",
    "initiate_checkout",
    "offsite_conversion.fb_pixel_initiate_checkout",
  ],
};

export const ACTION_METRICS = Object.keys(ACTION_PRIORITY) as ActionMetric[];

export type ActionTypeMap = Partial<Record<ActionMetric, string | null>>;

/** Lista de ações no formato da Graph API: [{action_type, value}] */
export type GraphActionList = Array<{ action_type: string; value: string | number }> | undefined;

export function actionListToRecord(list: GraphActionList): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of list ?? []) {
    const n = typeof a.value === "number" ? a.value : Number(a.value);
    if (Number.isFinite(n)) out[a.action_type] = (out[a.action_type] ?? 0) + n;
  }
  return out;
}

/**
 * Escolhe o tipo canônico por métrica considerando todos os tipos
 * presentes na conta. Mantém a escolha anterior se ainda presente e de
 * prioridade igual ou maior (evita trocar a definição entre sincronizações).
 */
export function chooseActionTypeMap(present: Set<string>, previous: ActionTypeMap = {}): ActionTypeMap {
  const out: ActionTypeMap = {};
  for (const metric of ACTION_METRICS) {
    const priority = ACTION_PRIORITY[metric];
    const best = priority.find((t) => present.has(t)) ?? null;
    const prev = previous[metric] ?? null;
    if (prev && best && priority.indexOf(prev) <= priority.indexOf(best)) out[metric] = prev;
    else out[metric] = best ?? prev ?? null;
  }
  return out;
}

export function extractMetric(record: Record<string, number>, map: ActionTypeMap, metric: ActionMetric): number {
  const t = map[metric];
  if (!t) return 0;
  return record[t] ?? 0;
}

export type ExtractedActions = {
  purchases: number;
  purchaseValue: number;
  leads: number;
  messagingConversations: number;
  landingPageViews: number;
  addToCart: number;
  initiateCheckout: number;
};

export function extractAll(
  actions: Record<string, number>,
  actionValues: Record<string, number>,
  map: ActionTypeMap,
): ExtractedActions {
  return {
    purchases: extractMetric(actions, map, "purchase"),
    purchaseValue: map.purchase ? (actionValues[map.purchase] ?? 0) : 0,
    leads: extractMetric(actions, map, "lead"),
    messagingConversations: extractMetric(actions, map, "messaging"),
    landingPageViews: extractMetric(actions, map, "landing_page_view"),
    addToCart: extractMetric(actions, map, "add_to_cart"),
    initiateCheckout: extractMetric(actions, map, "initiate_checkout"),
  };
}

export function trackingFromMap(map: ActionTypeMap) {
  return {
    purchase: Boolean(map.purchase),
    lead: Boolean(map.lead),
    messaging: Boolean(map.messaging),
    landingPageView: Boolean(map.landing_page_view),
    addToCart: Boolean(map.add_to_cart),
    initiateCheckout: Boolean(map.initiate_checkout),
  };
}

/* ------------------------------------------------------------------ */
/* Objetivos                                                           */
/* ------------------------------------------------------------------ */

export type ObjectiveGroup = "sales" | "leads" | "messaging" | "awareness" | "traffic" | "engagement" | "app" | "other";

export const OBJECTIVE_LABEL: Record<ObjectiveGroup, string> = {
  sales: "Vendas",
  leads: "Cadastros",
  messaging: "Mensagens",
  awareness: "Reconhecimento",
  traffic: "Tráfego",
  engagement: "Engajamento",
  app: "Promoção de app",
  other: "Outros",
};

const MESSAGING_DESTINATIONS = new Set(["MESSENGER", "WHATSAPP", "INSTAGRAM_DIRECT", "MESSAGING_MESSENGER_WHATSAPP", "MESSAGING_INSTAGRAM_DIRECT_MESSENGER", "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP"]);

/**
 * Agrupa o objetivo da campanha (ODAX e legados). Campanhas de engajamento
 * ou leads cujo destino é conversa são tratadas como "Mensagens".
 */
export function objectiveGroup(objective: string | null | undefined, destinationTypes: string[] = [], optimizationGoals: string[] = []): ObjectiveGroup {
  const o = (objective ?? "").toUpperCase();
  const isMessaging =
    o === "MESSAGES" ||
    destinationTypes.some((d) => MESSAGING_DESTINATIONS.has(d.toUpperCase())) ||
    optimizationGoals.some((g) => g.toUpperCase() === "CONVERSATIONS");
  const salesOptimizedForConversations =
    o === "OUTCOME_SALES" && optimizationGoals.length > 0 && optimizationGoals.every((g) => g.toUpperCase() === "CONVERSATIONS");
  if (isMessaging && (o === "OUTCOME_ENGAGEMENT" || o === "OUTCOME_LEADS" || o === "MESSAGES" || salesOptimizedForConversations))
    return "messaging";
  switch (o) {
    case "OUTCOME_SALES":
    case "CONVERSIONS":
    case "PRODUCT_CATALOG_SALES":
      return "sales";
    case "OUTCOME_LEADS":
    case "LEAD_GENERATION":
      return "leads";
    case "OUTCOME_AWARENESS":
    case "BRAND_AWARENESS":
    case "REACH":
      return "awareness";
    case "OUTCOME_TRAFFIC":
    case "LINK_CLICKS":
      return "traffic";
    case "OUTCOME_ENGAGEMENT":
    case "POST_ENGAGEMENT":
    case "PAGE_LIKES":
    case "VIDEO_VIEWS":
    case "EVENT_RESPONSES":
      return "engagement";
    case "OUTCOME_APP_PROMOTION":
    case "APP_INSTALLS":
      return "app";
    default:
      return "other";
  }
}
