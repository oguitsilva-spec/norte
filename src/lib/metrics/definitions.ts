import type { KpiKey } from "./core";
import type { MetricFormat } from "@/lib/format";

export type MetricDefinition = {
  key: KpiKey;
  label: string;
  short?: string;
  format: MetricFormat;
  /** Fórmula exibida ao usuário. */
  formula: string;
  source: string;
  aggregation: string;
  attribution?: string;
};

const ATTR =
  "Atribuição unificada: usa a configuração de atribuição de cada conjunto de anúncios (use_unified_attribution_setting=true), contada na data da impressão (action_report_time=impression).";

export const METRICS: Record<KpiKey, MetricDefinition> = {
  spend: {
    key: "spend",
    label: "Investimento",
    format: "currency",
    formula: "Soma de spend",
    source: "Meta Insights · campo spend (nível de anúncio, por dia)",
    aggregation: "Aditiva: soma entre dias, anúncios e campanhas da mesma conta (mesma moeda).",
  },
  purchases: {
    key: "purchases",
    label: "Compras",
    format: "number",
    formula: "Soma do action_type canônico de compra",
    source: "Meta Insights · actions (um único tipo por conta, ex.: omni_purchase)",
    aggregation: "Aditiva. Tipos sobrepostos (purchase, fb_pixel_purchase, omni_purchase…) nunca são somados.",
    attribution: ATTR,
  },
  purchaseValue: {
    key: "purchaseValue",
    label: "Receita atribuída",
    short: "Receita",
    format: "currency",
    formula: "Soma de action_values do tipo canônico de compra",
    source: "Meta Insights · action_values",
    aggregation: "Aditiva. É receita ATRIBUÍDA pela Meta: não é faturamento confirmado nem lucro.",
    attribution: ATTR,
  },
  roas: {
    key: "roas",
    label: "ROAS",
    format: "roas",
    formula: "Receita atribuída ÷ Investimento",
    source: "Calculado a partir dos totais",
    aggregation: "Recalculado a partir dos totais do recorte: nunca média de ROAS de campanhas. ROAS não é lucro nem ROI.",
    attribution: ATTR,
  },
  costPerPurchase: {
    key: "costPerPurchase",
    label: "Custo por compra",
    short: "CPA",
    format: "currency",
    formula: "Investimento ÷ Compras",
    source: "Calculado a partir dos totais",
    aggregation: "Recalculado a partir dos totais. Sem compras, fica indisponível (não é zero).",
    attribution: ATTR,
  },
  averageOrderValue: {
    key: "averageOrderValue",
    label: "Ticket médio",
    format: "currency",
    formula: "Receita atribuída ÷ Compras",
    source: "Calculado a partir dos totais",
    aggregation: "Recalculado a partir dos totais.",
    attribution: ATTR,
  },
  impressions: {
    key: "impressions",
    label: "Impressões",
    format: "number",
    formula: "Soma de impressions",
    source: "Meta Insights · impressions",
    aggregation: "Aditiva.",
  },
  linkClicks: {
    key: "linkClicks",
    label: "Cliques no link",
    format: "number",
    formula: "Soma de inline_link_clicks",
    source: "Meta Insights · inline_link_clicks",
    aggregation: "Aditiva.",
  },
  ctr: {
    key: "ctr",
    label: "CTR (link)",
    format: "pct",
    formula: "Cliques no link ÷ Impressões × 100",
    source: "Calculado a partir dos totais",
    aggregation: "Recalculado a partir dos totais.",
  },
  cpc: {
    key: "cpc",
    label: "CPC (link)",
    format: "currency",
    formula: "Investimento ÷ Cliques no link",
    source: "Calculado a partir dos totais",
    aggregation: "Recalculado a partir dos totais.",
  },
  cpm: {
    key: "cpm",
    label: "CPM",
    format: "currency",
    formula: "Investimento ÷ Impressões × 1.000",
    source: "Calculado a partir dos totais",
    aggregation: "Recalculado a partir dos totais.",
  },
  landingPageViews: {
    key: "landingPageViews",
    label: "Visualizações da página",
    format: "number",
    formula: "Soma do action_type canônico de landing page view",
    source: "Meta Insights · actions (omni_landing_page_view ou landing_page_view)",
    aggregation: "Aditiva.",
  },
  addToCart: {
    key: "addToCart",
    label: "Adições ao carrinho",
    format: "number",
    formula: "Soma do action_type canônico de add to cart",
    source: "Meta Insights · actions",
    aggregation: "Aditiva.",
    attribution: ATTR,
  },
  initiateCheckout: {
    key: "initiateCheckout",
    label: "Checkouts iniciados",
    format: "number",
    formula: "Soma do action_type canônico de initiate checkout",
    source: "Meta Insights · actions",
    aggregation: "Aditiva.",
    attribution: ATTR,
  },
  leads: {
    key: "leads",
    label: "Cadastros (leads)",
    short: "Leads",
    format: "number",
    formula: "Soma do action_type canônico de lead",
    source: "Meta Insights · actions (lead, onsite_conversion.lead_grouped…)",
    aggregation: "Aditiva. Lead qualificado só com fonte de CRM conectada (planejado).",
    attribution: ATTR,
  },
  costPerLead: {
    key: "costPerLead",
    label: "Custo por lead",
    short: "CPL",
    format: "currency",
    formula: "Investimento ÷ Leads",
    source: "Calculado a partir dos totais",
    aggregation: "Recalculado a partir dos totais.",
    attribution: ATTR,
  },
  messagingConversations: {
    key: "messagingConversations",
    label: "Conversas iniciadas",
    format: "number",
    formula: "Soma de onsite_conversion.messaging_conversation_started_7d",
    source: "Meta Insights · actions",
    aggregation: "Aditiva. Conversa iniciada NÃO é venda confirmada.",
  },
  costPerConversation: {
    key: "costPerConversation",
    label: "Custo por conversa",
    format: "currency",
    formula: "Investimento ÷ Conversas iniciadas",
    source: "Calculado a partir dos totais",
    aggregation: "Recalculado a partir dos totais.",
  },
};

export const NON_ADDITIVE_NOTE =
  "Alcance e frequência não são somáveis entre dias ou campanhas (a mesma pessoa pode ser alcançada várias vezes). São consultados na Meta para o intervalo exato e só aparecem quando esse intervalo foi sincronizado.";
