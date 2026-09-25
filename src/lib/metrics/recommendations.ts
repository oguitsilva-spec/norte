/**
 * Recomendações de otimização - regras explícitas derivadas do "Growth OS
 * Perpétuo" (skill trafego-perpetuo). Funções puras, sem I/O; testadas em
 * tests/recommendations.test.ts. Documentação: docs/RECOMMENDATIONS.md.
 *
 * Princípios aplicados (da skill):
 *  - funil analisado de BAIXO PARA CIMA (compra → checkout → página → clique);
 *    o gargalo mais próximo da venda é o principal;
 *  - benchmarks de referência: CTR 0,8% · Connect Rate 75% · Checkout 15% · Compra 10%;
 *  - CPA crescendo → reduzir investimento e testar criativos; CPA estável/caindo
 *    dentro da meta → aumentar 20-30%;
 *  - mínimo de 6 anúncios ativos; "pausou 1, sobe outro";
 *  - nunca decidir com um período curto: regras de tendência e escala exigem
 *    ≥ 7 dias e volume mínimo nos dois períodos.
 *
 * Salvaguardas (produto):
 *  - volume mínimo por regra; abaixo disso a regra não dispara e o motivo
 *    aparece em `skipped` ("Dados insuficientes");
 *  - evento não rastreado ≠ zero; sem dados ≠ zero;
 *  - períodos comparados têm o mesmo número de dias;
 *  - dias ainda em reconciliação (conversões atrasadas) geram ressalva;
 *  - "observação" (fato medido) é separada de "hipótese" (causa provável);
 *  - nenhuma confiança estatística ou ganho projetado é inventado;
 *  - metas só entram quando definidas pelo usuário.
 */
import { deriveKpis, ratio, daysBetweenInclusive, addDays, type Totals, type Tracking } from "./core";
import type { ObjectiveGroup } from "./actions";
import { RESULT_LABEL, resultCount, costPerResult, type ResultKind } from "./analysis";
import { fmtCurrency, fmtNumber, fmtPct, fmtRoas, fmtSignedPct, fmtRange } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export type RecPriority = "alta" | "media" | "baixa";
export type RecCategory = "rastreamento" | "resultado" | "funil" | "eficiencia" | "escala" | "criativo" | "remarketing" | "metas";
export type RecNature = "observacao" | "hipotese";

export type RecEntity = { type: "account" | "campaign" | "ad" | "funnel"; id?: string; name: string };

export type Recommendation = {
  /** Chave estável (regra + entidade) usada para guardar o status por workspace. */
  key: string;
  rule: RuleId;
  category: RecCategory;
  priority: RecPriority;
  nature: RecNature;
  title: string;
  entity: RecEntity;
  /** Evidência curta, com números observados. */
  evidence: string;
  /** Próximo passo específico. */
  action: string;
  /** Gasto envolvido (para ordenar dentro da mesma prioridade). */
  weight: number;
  analysis: {
    reasoning: string[];
    metrics: Array<{ label: string; value: string; reference?: string }>;
    thresholds: string[];
    comparison: string | null;
    limitations: string[];
  };
};

export type RuleId =
  | "tracking_revenue"
  | "tracking_purchase"
  | "spend_no_results_campaign"
  | "spend_no_results_ad"
  | "funnel_purchase_rate"
  | "funnel_checkout_rate"
  | "funnel_connect_rate"
  | "funnel_ctr"
  | "target_roas"
  | "target_cpa"
  | "cpa_rising"
  | "scale_opportunity"
  | "define_targets"
  | "creative_fatigue"
  | "creative_volume"
  | "replicate_winner"
  | "remarketing_missing";

export type RecEntityPerf = { id: string; name: string; status: string | null; current: Totals; previous: Totals };

export type RecInput = {
  currency: string;
  period: { from: string; to: string };
  previous: { from: string; to: string };
  /** Hoje no fuso da conta. */
  today: string;
  /** Dias recentes reprocessados a cada sincronização (conversões atrasadas). */
  reconciliationDays: number;
  kind: ResultKind;
  tracking: Tracking;
  targets: { roas?: number | null; cpa?: number | null };
  account: { current: Totals; previous: Totals };
  campaigns: Array<RecEntityPerf & { group: ObjectiveGroup }>;
  ads: Array<RecEntityPerf & { campaignId: string; campaignName: string; group: ObjectiveGroup }>;
  /** Anúncios com volume E eficiência acima da conta (do ranking com limiares mínimos). */
  winners: Array<{ id: string; name: string; campaignName: string; explanation: string; spend: number }>;
};

export type RecOutput = {
  items: Recommendation[];
  /** Regras que não puderam ser avaliadas e por quê ("Dados insuficientes"). */
  skipped: Array<{ rule: string; reason: string }>;
  period: { from: string; to: string; label: string; days: number };
  comparison: { from: string; to: string; label: string };
  /** Ressalvas gerais (ex.: dias ainda em reconciliação). */
  caveats: string[];
};

/* ------------------------------------------------------------------ */
/* Limiares (documentados em docs/RECOMMENDATIONS.md)                  */
/* ------------------------------------------------------------------ */

export const REC = {
  /** Referências do Growth OS (skill trafego-perpetuo). */
  benchmark: { ctr: 0.8, connectRate: 75, checkoutRate: 15, purchaseRate: 10 },
  /** Volume mínimo para avaliar cada etapa do funil. */
  minVolume: { impressions: 5000, linkClicks: 200, landingPageViews: 300, initiateCheckout: 30 },
  /** Tendência / escala. */
  minPeriodDays: 7,
  minPurchasesForTrend: 10,
  cpaRisingPct: 20,
  cpaStablePct: 5,
  /** Desgaste de criativo. */
  fatigueMinImpressions: 3000,
  fatigueCtrDropPct: 25,
  /** Ciclo de criativos. */
  minActiveAds: 6,
  /** Compras mínimas na conta para usar o CPA da conta como régua. */
  minAccountPurchases: 5,
  maxPerRule: 3,
} as const;

const PRIORITY_ORDER: Record<RecPriority, number> = { alta: 0, media: 1, baixa: 2 };
const REMARKETING_NAME = /(remarketing|retarget|rmkt|\bremk\b|p[úu]blico quente|\bquente\b|\bwarm\b|\bRT\b)/i;

/* ------------------------------------------------------------------ */
/* Motor                                                               */
/* ------------------------------------------------------------------ */

export function buildRecommendations(i: RecInput): RecOutput {
  const items: Recommendation[] = [];
  const skipped: RecOutput["skipped"] = [];
  const money = (v: number) => fmtCurrency(v, i.currency);
  const days = daysBetweenInclusive(i.period.from, i.period.to);
  const periodLabel = fmtRange(i.period.from, i.period.to);
  const prevLabel = fmtRange(i.previous.from, i.previous.to);
  const cur = i.account.current;
  const accK = deriveKpis(cur, i.tracking);
  const sales = i.kind === "purchases";
  const label = RESULT_LABEL[i.kind];

  // Dias que ainda recebem conversões atrasadas dentro do período.
  const reconStart = addDays(i.today, -(Math.max(1, i.reconciliationDays) - 1));
  const caveats: string[] = [];
  const recentOverlap = i.period.to >= reconStart;
  if (recentOverlap) {
    const overlapFrom = i.period.from > reconStart ? i.period.from : reconStart;
    const n = daysBetweenInclusive(overlapFrom, i.period.to);
    caveats.push(`Os últimos ${n} ${n === 1 ? "dia" : "dias"} do período ainda podem receber conversões atrasadas; números recentes tendem a subir.`);
  }
  if (i.period.to >= i.today) caveats.push("O período inclui hoje, que ainda está em andamento.");
  const aggregateNote = "Etapas do funil são contagens agregadas de eventos da Meta, não as mesmas pessoas avançando em ordem.";
  const attributionNote = "Compras e receita são atribuídas pela Meta (janela de cada conjunto) e podem diferir das vendas confirmadas no checkout.";

  const out: RecOutput = {
    items,
    skipped,
    period: { from: i.period.from, to: i.period.to, label: periodLabel, days },
    comparison: { from: i.previous.from, to: i.previous.to, label: prevLabel },
    caveats,
  };

  if (cur.rows === 0 || cur.spend <= 0) {
    skipped.push({ rule: "Todas", reason: "Sem investimento no período selecionado." });
    return out;
  }
  const trendOk = days >= REC.minPeriodDays;
  if (!trendOk) skipped.push({ rule: "Tendência e escala", reason: `Período de ${days} ${days === 1 ? "dia" : "dias"}: comparações e escala exigem pelo menos ${REC.minPeriodDays} dias.` });

  /* 1) Rastreamento --------------------------------------------------- */
  const salesSpend = i.campaigns.filter((c) => c.group === "sales").reduce((s, c) => s + c.current.spend, 0);
  if (salesSpend > 0 && !i.tracking.purchase) {
    items.push({
      key: "tracking_purchase:account",
      rule: "tracking_purchase",
      category: "rastreamento",
      priority: "alta",
      nature: "observacao",
      title: "Compras não estão sendo medidas",
      entity: { type: "account", name: "Conta" },
      evidence: `${money(salesSpend)} em campanhas de vendas e nenhum evento de compra encontrado na conta.`,
      action: "Configurar o evento de compra no pixel e na API de conversões antes de otimizar por vendas.",
      weight: salesSpend,
      analysis: {
        reasoning: ["Sem o evento de compra, ROAS, custo por venda e receita não podem ser calculados; qualquer decisão de orçamento fica sem base."],
        metrics: [{ label: "Investimento em vendas", value: money(salesSpend) }],
        thresholds: ["Dispara quando há gasto em campanhas de vendas e nenhum tipo de ação de compra na conta."],
        comparison: null,
        limitations: ["A detecção considera os tipos de ação de compra retornados pela Meta na janela sincronizada."],
      },
    });
  }
  if (sales && i.tracking.purchase && cur.purchases >= REC.minAccountPurchases && cur.purchaseValue <= 0) {
    items.push({
      key: "tracking_revenue:account",
      rule: "tracking_revenue",
      category: "rastreamento",
      priority: "alta",
      nature: "observacao",
      title: "Compras chegam sem valor",
      entity: { type: "account", name: "Conta" },
      evidence: `${fmtNumber(cur.purchases)} compras atribuídas e receita igual a zero.`,
      action: "Enviar os parâmetros value e currency no evento de compra (pixel e API de conversões).",
      weight: cur.spend,
      analysis: {
        reasoning: ["Sem valor na compra, o ROAS aparece como zero e o ranking por receita perde sentido."],
        metrics: [
          { label: "Compras", value: fmtNumber(cur.purchases) },
          { label: "Receita atribuída", value: money(cur.purchaseValue) },
        ],
        thresholds: [`≥ ${REC.minAccountPurchases} compras e receita = 0.`],
        comparison: null,
        limitations: [attributionNote],
      },
    });
  }

  /* 2) Investimento sem resultado ------------------------------------- */
  const accCpr = costPerResult(cur, i.kind);
  if (sales && i.tracking.purchase) {
    const threshold = Math.max(accK.costPerPurchase.ok ? accK.costPerPurchase.value * 2 : 0, cur.spend * 0.05);
    const hits = i.campaigns
      .filter((c) => c.group === "sales" && threshold > 0 && c.current.spend >= threshold && c.current.purchases === 0)
      .sort((a, b) => b.current.spend - a.current.spend)
      .slice(0, REC.maxPerRule);
    for (const c of hits) {
      items.push({
        key: `spend_no_results_campaign:${c.id}`,
        rule: "spend_no_results_campaign",
        category: "resultado",
        priority: "alta",
        nature: "observacao",
        title: "Investimento sem vendas",
        entity: { type: "campaign", id: c.id, name: c.name },
        evidence: `${money(c.current.spend)} investidos e nenhuma compra atribuída.`,
        action: "Reduzir o orçamento e revisar criativo e público; se já passou de 48h sem ajustes, pausar e subir novos anúncios.",
        weight: c.current.spend,
        analysis: {
          reasoning: [
            `O gasto já é ${accK.costPerPurchase.ok ? `${fmtNumber(c.current.spend / accK.costPerPurchase.value, 1)}× o custo por venda da conta` : "relevante"} sem nenhuma compra.`,
            "Growth OS: não alterar antes de 48h de veiculação; depois disso, CPA sem resultado pede redução de investimento e novos criativos.",
          ],
          metrics: [
            { label: "Investimento", value: money(c.current.spend) },
            { label: "Compras", value: "0" },
            ...(accK.costPerPurchase.ok ? [{ label: "Custo por venda da conta", value: money(accK.costPerPurchase.value) }] : []),
          ],
          thresholds: [`Gasto ≥ ${money(threshold)} (maior entre 2× o custo por venda da conta e 5% do investimento total) e 0 compras.`],
          comparison: null,
          limitations: [attributionNote, ...(recentOverlap ? ["Compras atrasadas ainda podem ser atribuídas aos dias mais recentes."] : [])],
        },
      });
    }
  }
  if (accCpr.ok && resultCount(cur, i.kind) >= REC.minAccountPurchases && (!sales || i.tracking.purchase) && i.kind !== "impressions" && i.kind !== "linkClicks") {
    const threshold = accCpr.value * 2;
    // Só compara anúncios do mesmo objetivo (ex.: anúncio de cadastro não é cobrado por vendas).
    const sameGroup: Partial<Record<ResultKind, ObjectiveGroup>> = { purchases: "sales", leads: "leads", messaging: "messaging" };
    const hits = i.ads
      .filter((a) => (!sameGroup[i.kind] || a.group === sameGroup[i.kind]) && a.current.spend >= threshold && resultCount(a.current, i.kind) === 0)
      .sort((a, b) => b.current.spend - a.current.spend)
      .slice(0, REC.maxPerRule);
    for (const a of hits) {
      items.push({
        key: `spend_no_results_ad:${a.id}`,
        rule: "spend_no_results_ad",
        category: "criativo",
        priority: "media",
        nature: "observacao",
        title: "Revisar este anúncio",
        entity: { type: "ad", id: a.id, name: a.name },
        evidence: `${money(a.current.spend)} investidos sem ${label.plural}; a conta gasta em média ${money(accCpr.value)} por ${label.singular}.`,
        action: "Pausar e subir um criativo novo no lugar (ciclo: pausou 1, sobe outro).",
        weight: a.current.spend,
        analysis: {
          reasoning: [`O anúncio já consumiu mais que o dobro do que a conta costuma gastar para gerar 1 ${label.singular}.`],
          metrics: [
            { label: "Investimento", value: money(a.current.spend) },
            { label: label.plural[0].toUpperCase() + label.plural.slice(1), value: "0" },
            { label: `${label.cost} da conta`, value: money(accCpr.value) },
          ],
          thresholds: [`Gasto ≥ 2× o ${label.cost.toLowerCase()} da conta (${money(threshold)}) e 0 resultados; conta com ≥ ${REC.minAccountPurchases} resultados.`],
          comparison: null,
          limitations: [`Campanha: ${a.campaignName}.`, ...(recentOverlap ? ["Conversões atrasadas ainda podem aparecer nos dias mais recentes."] : [])],
        },
      });
    }
  }

  /* 3) Funil de baixo para cima --------------------------------------- */
  type Stage = { rule: RuleId; title: string; rate: number | null; bench: number; volumeOk: boolean; volumeNote: string; metricLabel: string; action: string; hypothesis: string; num: number; den: number; numLabel: string; denLabel: string };
  const stages: Stage[] = [];
  if (sales && i.tracking.purchase && i.tracking.initiateCheckout) {
    const r = ratio(cur.purchases, cur.initiateCheckout, 100);
    stages.push({
      rule: "funnel_purchase_rate",
      title: "Checkouts que não viram venda",
      rate: r.ok ? r.value : null,
      bench: REC.benchmark.purchaseRate,
      volumeOk: cur.initiateCheckout >= REC.minVolume.initiateCheckout,
      volumeNote: `${fmtNumber(cur.initiateCheckout)} checkouts (mínimo ${REC.minVolume.initiateCheckout})`,
      metricLabel: "Taxa de compra",
      action: "Deixar o preço visível antes do checkout, oferecer mais meios de pagamento e reforçar a promessa no checkout.",
      hypothesis: "Causas prováveis: checkout lento ou desconfiável, poucas opções de pagamento, diferença de preço, frete.",
      num: cur.purchases,
      den: cur.initiateCheckout,
      numLabel: "Compras",
      denLabel: "Checkouts iniciados",
    });
  }
  if (sales && i.tracking.initiateCheckout && i.tracking.landingPageView) {
    const r = ratio(cur.initiateCheckout, cur.landingPageViews, 100);
    stages.push({
      rule: "funnel_checkout_rate",
      title: "Página converte pouco em checkout",
      rate: r.ok ? r.value : null,
      bench: REC.benchmark.checkoutRate,
      volumeOk: cur.landingPageViews >= REC.minVolume.landingPageViews,
      volumeNote: `${fmtNumber(cur.landingPageViews)} visualizações da página (mínimo ${REC.minVolume.landingPageViews})`,
      metricLabel: "Taxa de checkout",
      action: "Testar novas promessas e headlines e conferir se o anúncio gera a expectativa certa para a página.",
      hypothesis: "Causas prováveis: público desqualificado, anúncio desalinhado com a página, oferta ou preço, design sem confiança.",
      num: cur.initiateCheckout,
      den: cur.landingPageViews,
      numLabel: "Checkouts iniciados",
      denLabel: "Visualizações da página",
    });
  }
  if (i.tracking.landingPageView) {
    const r = ratio(cur.landingPageViews, cur.linkClicks, 100);
    stages.push({
      rule: "funnel_connect_rate",
      title: "Cliques se perdem antes da página",
      rate: r.ok ? r.value : null,
      bench: REC.benchmark.connectRate,
      volumeOk: cur.linkClicks >= REC.minVolume.linkClicks,
      volumeNote: `${fmtNumber(cur.linkClicks)} cliques no link (mínimo ${REC.minVolume.linkClicks})`,
      metricLabel: "Connect rate",
      action: "Medir a velocidade da página, instalar o pixel via GTM e ativar a API de conversões.",
      hypothesis: "Causas prováveis: página lenta, redirecionamentos ou pixel disparando tarde.",
      num: cur.landingPageViews,
      den: cur.linkClicks,
      numLabel: "Visualizações da página",
      denLabel: "Cliques no link",
    });
  }
  {
    const r = ratio(cur.linkClicks, cur.impressions, 100);
    stages.push({
      rule: "funnel_ctr",
      title: "Anúncios atraem poucos cliques",
      rate: r.ok ? r.value : null,
      bench: REC.benchmark.ctr,
      volumeOk: cur.impressions >= REC.minVolume.impressions,
      volumeNote: `${fmtNumber(cur.impressions)} impressões (mínimo ${fmtNumber(REC.minVolume.impressions)})`,
      metricLabel: "CTR (link)",
      action: "Testar novos criativos primeiro (1 criativo por conjunto, ABO) e só depois novos públicos.",
      hypothesis: "Causas prováveis: criativo sem gancho forte, público mal segmentado ou ambos.",
      num: cur.linkClicks,
      den: cur.impressions,
      numLabel: "Cliques no link",
      denLabel: "Impressões",
    });
  }
  let primaryFound = false;
  let primaryTitle = "";
  for (const s of stages) {
    // Ordem de avaliação: de baixo para cima. O primeiro que falha é o gargalo principal.
    if (!s.volumeOk) {
      skipped.push({ rule: s.metricLabel, reason: `Dados insuficientes: ${s.volumeNote}.` });
      continue;
    }
    if (s.rate === null || s.rate >= s.bench) continue;
    const primary = !primaryFound;
    if (primary) primaryTitle = s.title;
    primaryFound = true;
    const decimals = s.rule === "funnel_ctr" ? 2 : 1;
    items.push({
      key: `${s.rule}:account`,
      rule: s.rule,
      category: "funil",
      priority: primary ? "alta" : "media",
      nature: "hipotese",
      title: s.title,
      entity: { type: "funnel", name: primary ? "Gargalo principal do funil" : "Gargalo secundário do funil" },
      evidence: `${s.metricLabel} de ${fmtPct(s.rate, decimals)}, abaixo da referência de ${fmtPct(s.bench, decimals)}.`,
      action: s.action,
      weight: cur.spend * (primary ? 1 : 0.5),
      analysis: {
        reasoning: [
          primary
            ? "É a etapa com problema mais próxima da venda: o Growth OS analisa o funil de baixo para cima e resolve primeiro o gargalo mais próximo do resultado."
            : "Etapa abaixo da referência, porém mais distante da venda do que o gargalo principal.",
          s.hypothesis,
        ],
        metrics: [
          { label: s.numLabel, value: fmtNumber(s.num) },
          { label: s.denLabel, value: fmtNumber(s.den) },
          { label: s.metricLabel, value: fmtPct(s.rate, decimals), reference: `referência ${fmtPct(s.bench, decimals)}` },
        ],
        thresholds: [`${s.metricLabel} < ${fmtPct(s.bench, decimals)} com ${s.volumeNote}.`, "Quanto maior o ticket, menores tendem a ser as taxas: use a referência como ponto de investigação, não como meta."],
        comparison: null,
        limitations: [aggregateNote],
      },
    });
  }

  /* 4) Metas do usuário ----------------------------------------------- */
  if (sales && i.tracking.purchase && cur.purchases >= REC.minAccountPurchases) {
    const roasMiss = Boolean(i.targets.roas && accK.roas.ok && accK.roas.value < i.targets.roas);
    const cpaMiss = Boolean(i.targets.cpa && accK.costPerPurchase.ok && accK.costPerPurchase.value > i.targets.cpa);
    if (roasMiss || cpaMiss) {
      const parts: string[] = [];
      if (roasMiss && accK.roas.ok) parts.push(`ROAS de ${fmtRoas(accK.roas.value)} para uma meta de ${fmtRoas(i.targets.roas!)}`);
      if (cpaMiss && accK.costPerPurchase.ok) parts.push(`custo por venda de ${money(accK.costPerPurchase.value)} para uma meta de ${money(i.targets.cpa!)}`);
      const evidence = parts.join("; ") + ".";
      items.push({
        key: "target_account:account",
        rule: roasMiss ? "target_roas" : "target_cpa",
        category: "metas",
        priority: "media",
        nature: "observacao",
        title: roasMiss && cpaMiss ? "Metas de ROAS e custo por venda não atingidas" : roasMiss ? "ROAS abaixo da meta" : "Custo por venda acima da meta",
        entity: { type: "account", name: "Conta" },
        evidence: evidence[0].toUpperCase() + evidence.slice(1),
        action: primaryFound
          ? `Atacar primeiro o gargalo do funil (“${primaryTitle}”) e não aumentar o orçamento enquanto a meta não voltar.`
          : "Reduzir o investimento nas campanhas fora da meta e testar novos criativos; redistribuir para as que estão dentro.",
        weight: cur.spend * 0.9,
        analysis: {
          reasoning: ["Growth OS: CPA acima do esperado pede redução de investimento e novos criativos, não aumento de verba.", "ROAS é a receita atribuída para cada real investido; não é lucro."],
          metrics: [
            ...(accK.roas.ok ? [{ label: "ROAS", value: fmtRoas(accK.roas.value), reference: i.targets.roas ? `meta ${fmtRoas(i.targets.roas)}` : undefined }] : []),
            ...(accK.costPerPurchase.ok ? [{ label: "Custo por venda", value: money(accK.costPerPurchase.value), reference: i.targets.cpa ? `meta ${money(i.targets.cpa)}` : undefined }] : []),
            { label: "Vendas", value: fmtNumber(cur.purchases) },
          ],
          thresholds: ["ROAS do período < meta, ou custo por venda > meta (metas definidas em Configurações)."],
          comparison: null,
          limitations: [attributionNote],
        },
      });
    }
  }

  /* 5) Tendência e escala por campanha -------------------------------- */
  if (sales && i.tracking.purchase && trendOk) {
    const eligible = i.campaigns.filter((c) => c.group === "sales" && c.current.purchases >= REC.minPurchasesForTrend && c.previous.purchases >= REC.minPurchasesForTrend);
    if (!eligible.length) skipped.push({ rule: "Tendência por campanha", reason: `Nenhuma campanha com ≥ ${REC.minPurchasesForTrend} vendas nos dois períodos.` });
    const hasTargets = Boolean(i.targets.roas || i.targets.cpa);
    const rising: Recommendation[] = [];
    const scale: Recommendation[] = [];
    for (const c of eligible) {
      const k = deriveKpis(c.current, i.tracking);
      const pk = deriveKpis(c.previous, i.tracking);
      if (!k.costPerPurchase.ok || !pk.costPerPurchase.ok) continue;
      const change = ((k.costPerPurchase.value - pk.costPerPurchase.value) / pk.costPerPurchase.value) * 100;
      const metrics = [
        { label: "Custo por venda", value: money(k.costPerPurchase.value), reference: `antes ${money(pk.costPerPurchase.value)}` },
        { label: "Vendas", value: fmtNumber(c.current.purchases), reference: `antes ${fmtNumber(c.previous.purchases)}` },
        ...(k.roas.ok ? [{ label: "ROAS", value: fmtRoas(k.roas.value), reference: pk.roas.ok ? `antes ${fmtRoas(pk.roas.value)}` : undefined }] : []),
      ];
      if (change >= REC.cpaRisingPct) {
        rising.push({
          key: `cpa_rising:${c.id}`,
          rule: "cpa_rising",
          category: "eficiencia",
          priority: "media",
          nature: "observacao",
          title: "Custo por venda subindo",
          entity: { type: "campaign", id: c.id, name: c.name },
          evidence: `Custo por venda ${fmtSignedPct(change)} (${money(pk.costPerPurchase.value)} → ${money(k.costPerPurchase.value)}).`,
          action: "Reduzir o orçamento e subir novos criativos; reavaliar na mesma janela de análise.",
          weight: c.current.spend,
          analysis: {
            reasoning: ["Growth OS: CPA crescendo → reduzir investimento e testar novos criativos.", "A variação mostra mudança de desempenho, não a causa."],
            metrics,
            thresholds: [`Alta ≥ ${REC.cpaRisingPct}% com ≥ ${REC.minPurchasesForTrend} vendas em cada período e período ≥ ${REC.minPeriodDays} dias.`],
            comparison: `${periodLabel} vs ${prevLabel} (mesmo número de dias).`,
            limitations: [attributionNote, ...(recentOverlap ? ["O período atual ainda pode receber conversões atrasadas; o anterior já está consolidado."] : [])],
          },
        });
      } else if (hasTargets && change <= REC.cpaStablePct) {
        const meetsRoas = i.targets.roas ? k.roas.ok && k.roas.value >= i.targets.roas : true;
        const meetsCpa = i.targets.cpa ? k.costPerPurchase.value <= i.targets.cpa : true;
        if (meetsRoas && meetsCpa) {
          scale.push({
            key: `scale_opportunity:${c.id}`,
            rule: "scale_opportunity",
            category: "escala",
            priority: "baixa",
            nature: "observacao",
            title: "Espaço para escalar",
            entity: { type: "campaign", id: c.id, name: c.name },
            evidence: `${fmtNumber(c.current.purchases)} vendas dentro da meta e custo por venda ${change <= 0 ? "caindo" : "estável"} (${fmtSignedPct(change)}).`,
            action: "Aumentar o orçamento em 20–30% e manter o mesmo período de análise; se atingir o teto, duplicar o conjunto.",
            weight: c.current.spend,
            analysis: {
              reasoning: ["Growth OS: CPA estável ou caindo, dentro do esperado → aumentar investimento 20–30%.", "Escalar em passos pequenos reduz o risco de desestabilizar a entrega."],
              metrics,
              thresholds: [
                `Meta${i.targets.roas ? ` de ROAS ${fmtRoas(i.targets.roas)}` : ""}${i.targets.roas && i.targets.cpa ? " e" : ""}${i.targets.cpa ? ` de custo por venda ${money(i.targets.cpa)}` : ""} atendida.`,
                `Custo por venda variando ≤ ${REC.cpaStablePct}% com ≥ ${REC.minPurchasesForTrend} vendas em cada período.`,
              ],
              comparison: `${periodLabel} vs ${prevLabel} (mesmo número de dias).`,
              limitations: ["Não há projeção de ganho: o resultado depois do aumento precisa ser medido.", attributionNote],
            },
          });
        }
      }
    }
    items.push(...rising.sort((a, b) => b.weight - a.weight).slice(0, REC.maxPerRule), ...scale.sort((a, b) => b.weight - a.weight).slice(0, REC.maxPerRule));
    if (!hasTargets && eligible.length) {
      items.push({
        key: "define_targets:account",
        rule: "define_targets",
        category: "metas",
        priority: "baixa",
        nature: "observacao",
        title: "Defina suas metas",
        entity: { type: "account", name: "Conta" },
        evidence: "Sem meta de ROAS ou de custo por venda, não é possível dizer quais campanhas estão prontas para escalar.",
        action: "Informar a meta de ROAS ou de custo por venda em Configurações.",
        weight: 0,
        analysis: {
          reasoning: ["As regras de escala só usam metas definidas por você; o Norte não inventa metas."],
          metrics: [],
          thresholds: [],
          comparison: null,
          limitations: [],
        },
      });
    }
  }

  /* 6) Criativos ------------------------------------------------------- */
  if (trendOk) {
    const fatigue: Recommendation[] = [];
    for (const a of i.ads) {
      if (a.current.impressions < REC.fatigueMinImpressions || a.previous.impressions < REC.fatigueMinImpressions) continue;
      const ctr = ratio(a.current.linkClicks, a.current.impressions, 100);
      const pctr = ratio(a.previous.linkClicks, a.previous.impressions, 100);
      if (!ctr.ok || !pctr.ok || pctr.value <= 0) continue;
      const drop = ((ctr.value - pctr.value) / pctr.value) * 100;
      if (drop > -REC.fatigueCtrDropPct) continue;
      const cpr = costPerResult(a.current, i.kind);
      const pcpr = costPerResult(a.previous, i.kind);
      const cprUp = cpr.ok && pcpr.ok && cpr.value > pcpr.value;
      fatigue.push({
        key: `creative_fatigue:${a.id}`,
        rule: "creative_fatigue",
        category: "criativo",
        priority: cprUp ? "media" : "baixa",
        nature: "hipotese",
        title: "Possível desgaste do criativo",
        entity: { type: "ad", id: a.id, name: a.name },
        evidence: `CTR caiu ${fmtPct(Math.abs(drop))} (${fmtPct(pctr.value, 2)} → ${fmtPct(ctr.value, 2)})${cprUp && cpr.ok && pcpr.ok ? ` e o ${label.cost.toLowerCase()} subiu para ${money(cpr.value)}` : ""}.`,
        action: "Preparar variações com o mesmo ângulo e um gancho novo; se o custo continuar subindo, pausar e subir a variação.",
        weight: a.current.spend,
        analysis: {
          reasoning: ["Queda forte de CTR no mesmo anúncio costuma indicar que o público já viu o criativo muitas vezes. É uma hipótese: mudanças de público, leilão ou sazonalidade também reduzem o CTR."],
          metrics: [
            { label: "CTR (link)", value: fmtPct(ctr.value, 2), reference: `antes ${fmtPct(pctr.value, 2)}` },
            { label: "Impressões", value: fmtNumber(a.current.impressions), reference: `antes ${fmtNumber(a.previous.impressions)}` },
            ...(cpr.ok ? [{ label: label.cost, value: money(cpr.value), reference: pcpr.ok ? `antes ${money(pcpr.value)}` : undefined }] : []),
          ],
          thresholds: [`CTR ≥ ${REC.fatigueCtrDropPct}% menor que no período anterior, com ≥ ${fmtNumber(REC.fatigueMinImpressions)} impressões em cada período.`],
          comparison: `${periodLabel} vs ${prevLabel}.`,
          limitations: ["Frequência por anúncio não é sincronizada; o desgaste é inferido pela queda de CTR.", `Campanha: ${a.campaignName}.`],
        },
      });
    }
    items.push(...fatigue.sort((a, b) => b.weight - a.weight).slice(0, REC.maxPerRule));
  }

  const activeAds = i.ads.filter((a) => a.current.spend > 0 && (!a.status || a.status === "ACTIVE"));
  if (activeAds.length > 0 && activeAds.length < REC.minActiveAds) {
    items.push({
      key: "creative_volume:account",
      rule: "creative_volume",
      category: "criativo",
      priority: "baixa",
      nature: "observacao",
      title: "Poucos anúncios ativos",
      entity: { type: "account", name: "Conta" },
      evidence: `${activeAds.length} ${activeAds.length === 1 ? "anúncio ativo" : "anúncios ativos"} com entrega no período.`,
      action: `Manter pelo menos ${REC.minActiveAds} anúncios ativos e subir de 5 a 10 criativos novos por semana.`,
      weight: cur.spend * 0.2,
      analysis: {
        reasoning: ["Growth OS: a escala no perpétuo é proporcional à quantidade de criativos veiculados; com poucos anúncios, a conta depende de poucos ganchos."],
        metrics: [{ label: "Anúncios ativos com entrega", value: fmtNumber(activeAds.length), reference: `referência ≥ ${REC.minActiveAds}` }],
        thresholds: [`Menos de ${REC.minActiveAds} anúncios ativos com gasto no período.`],
        comparison: null,
        limitations: ["Considera o status atual do anúncio e o gasto no período filtrado."],
      },
    });
  }

  for (const w of i.winners.slice(0, 1)) {
    items.push({
      key: `replicate_winner:${w.id}`,
      rule: "replicate_winner",
      category: "criativo",
      priority: "baixa",
      nature: "observacao",
      title: "Replicar o que está funcionando",
      entity: { type: "ad", id: w.id, name: w.name },
      evidence: w.explanation,
      action: "Pedir novos criativos com o mesmo gancho e estrutura e testá-los um por conjunto (ABO).",
      weight: w.spend * 0.5,
      analysis: {
        reasoning: ["Growth OS: solicitar criativos baseados nos anúncios que estão performando bem é a forma mais barata de ampliar a escala."],
        metrics: [],
        thresholds: ["Anúncio acima dos limiares mínimos do ranking, entre os 25% com mais resultados e ≥ 20% mais eficiente que a conta."],
        comparison: "Média da conta no mesmo período.",
        limitations: ["Ranking descritivo, sem teste de significância estatística.", `Campanha: ${w.campaignName}.`],
      },
    });
  }

  /* 7) Remarketing (hipótese, identificado pelo nome) ------------------ */
  if (sales && i.tracking.initiateCheckout && cur.initiateCheckout >= 50) {
    const hasRmkt = i.campaigns.some((c) => c.current.spend > 0 && REMARKETING_NAME.test(c.name));
    if (!hasRmkt) {
      items.push({
        key: "remarketing_missing:account",
        rule: "remarketing_missing",
        category: "remarketing",
        priority: "baixa",
        nature: "hipotese",
        title: "Sem remarketing identificado",
        entity: { type: "account", name: "Conta" },
        evidence: `${fmtNumber(cur.initiateCheckout)} checkouts iniciados e nenhuma campanha com nome de remarketing em veiculação.`,
        action: "Criar uma campanha ABO para quem viu a página ou o checkout (7 a 30 dias), com 4 a 6 anúncios de quebra de objeção e excluindo compradores.",
        weight: cur.spend * 0.15,
        analysis: {
          reasoning: ["Growth OS: remarketing com orçamento mínimo recupera quem já demonstrou interesse, com anúncios de prova, garantia e bônus."],
          metrics: [
            { label: "Checkouts iniciados", value: fmtNumber(cur.initiateCheckout) },
            { label: "Vendas", value: fmtNumber(cur.purchases) },
          ],
          thresholds: ["≥ 50 checkouts iniciados e nenhuma campanha ativa cujo nome indique remarketing (ex.: remarketing, retarget, RMKT, quente)."],
          comparison: null,
          limitations: ["O Norte identifica remarketing pelo nome da campanha; se o seu remarketing tem outro nome, dispense esta sugestão."],
        },
      });
    }
  }

  items.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.weight - a.weight);
  return out;
}

export const CATEGORY_LABEL: Record<RecCategory, string> = {
  rastreamento: "Rastreamento",
  resultado: "Resultado",
  funil: "Funil",
  eficiencia: "Eficiência",
  escala: "Escala",
  criativo: "Criativo",
  remarketing: "Remarketing",
  metas: "Metas",
};

export const PRIORITY_LABEL: Record<RecPriority, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };
