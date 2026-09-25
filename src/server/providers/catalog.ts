/**
 * Catálogo de fontes de dados. Somente a Meta está implementada; as demais
 * aparecem como planejadas na interface (nenhuma integração falsa).
 * Novos provedores implementam o mesmo contrato do serviço Meta:
 * autorização → descoberta de contas → sincronização para as tabelas
 * normalizadas (campaigns/ad_sets/ads/insights_daily) com provider próprio.
 */
export type ProviderCatalogItem = {
  id: string;
  name: string;
  category: "ads" | "checkout" | "crm" | "analytics";
  status: "available" | "planned";
  description: string;
};

export const PROVIDERS: ProviderCatalogItem[] = [
  { id: "meta", name: "Meta Ads", category: "ads", status: "available", description: "Facebook e Instagram. Leitura de campanhas, anúncios e métricas via Marketing API." },
  { id: "google_ads", name: "Google Ads", category: "ads", status: "planned", description: "Pesquisa, Performance Max e YouTube." },
  { id: "tiktok_ads", name: "TikTok Ads", category: "ads", status: "planned", description: "Campanhas e criativos do TikTok." },
  { id: "shopify", name: "Shopify", category: "checkout", status: "planned", description: "Pedidos confirmados, para comparar com a receita atribuída." },
  { id: "nuvemshop", name: "Nuvemshop", category: "checkout", status: "planned", description: "Pedidos confirmados de lojas Nuvemshop." },
  { id: "hotmart", name: "Hotmart", category: "checkout", status: "planned", description: "Vendas de produtos digitais." },
  { id: "rd_station", name: "RD Station CRM", category: "crm", status: "planned", description: "Leads qualificados e vendas fechadas." },
  { id: "sales_csv", name: "Importação de vendas (CSV)", category: "checkout", status: "planned", description: "Vendas confirmadas de qualquer sistema, via planilha." },
  { id: "ga4", name: "Google Analytics 4", category: "analytics", status: "planned", description: "Funis sequenciais por sessão/usuário." },
];
