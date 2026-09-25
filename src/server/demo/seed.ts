import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { createWorkspace } from "@/server/tenancy/workspaces";
import { actionListToRecord, chooseActionTypeMap, extractAll } from "@/lib/metrics/actions";
import { addDays, todayInTimezone } from "@/lib/metrics/core";
import { reachPeriods } from "@/server/sync/runner";

/**
 * Modo demonstração: cria um workspace PRÓPRIO do usuário, marcado como
 * is_demo, com dados fictícios porém internamente consistentes, gravados
 * nas mesmas tabelas e lidos pelo mesmo motor de métricas.
 * - Nunca é misturado a dados reais (workspace separado).
 * - O worker ignora workspaces demo (nenhuma chamada à Meta).
 * - Toda a interface exibe o selo "Modo demonstração".
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type CampaignSpec = {
  ext: string;
  name: string;
  objective: string;
  kind: "sales" | "leads" | "messaging" | "awareness" | "sales_bad";
  dailySpend: number;
  cpm: number;
  ctr: number;
  cvr: number; // compra/lead/conversa por clique
  aov: number;
  startDay: number; // dias atrás em que começou
  trend: number; // variação de eficiência ao longo do tempo (-/+)
  destination?: string;
  status?: string;
  adSets: Array<{ name: string; ads: string[] }>;
};

const CAMPAIGNS: CampaignSpec[] = [
  {
    ext: "demo_c_1", name: "[Vendas] Prospecção Advantage+", objective: "OUTCOME_SALES", kind: "sales", dailySpend: 820, cpm: 24, ctr: 0.0125, cvr: 0.021, aov: 189, startDay: 140, trend: 0.05,
    adSets: [
      { name: "Advantage+ Brasil", ads: ["Vídeo UGC · Rotina da manhã", "Carrossel · Mais vendidos", "Estático · Frete grátis"] },
      { name: "Interesses · Casa e decoração", ads: ["Vídeo · Antes e depois", "Estático · Kit presente"] },
    ],
  },
  {
    ext: "demo_c_2", name: "[Vendas] Remarketing 30 dias", objective: "OUTCOME_SALES", kind: "sales", dailySpend: 310, cpm: 38, ctr: 0.021, cvr: 0.045, aov: 214, startDay: 140, trend: -0.02,
    adSets: [
      { name: "Visitantes do site 30d", ads: ["Dinâmico · Produtos vistos", "Depoimento · Cliente real"] },
      { name: "Carrinho abandonado 14d", ads: ["Cupom 10% · Volte", "Vídeo · Garantia 60 dias"] },
    ],
  },
  {
    ext: "demo_c_3", name: "[Vendas] Catálogo DPA", objective: "OUTCOME_SALES", kind: "sales", dailySpend: 260, cpm: 21, ctr: 0.0145, cvr: 0.024, aov: 162, startDay: 110, trend: 0,
    adSets: [{ name: "Catálogo completo", ads: ["Coleção · Carrossel dinâmico", "Coleção · Destaques da semana"] }],
  },
  {
    ext: "demo_c_4", name: "[Vendas] Coleção Inverno", objective: "OUTCOME_SALES", kind: "sales", dailySpend: 420, cpm: 27, ctr: 0.011, cvr: 0.017, aov: 236, startDay: 45, trend: -0.35,
    adSets: [
      { name: "Lookalike 2% compradores", ads: ["Reels · Mantas e texturas", "Estático · Lançamento"] },
      { name: "Advantage+ público", ads: ["Vídeo · Bastidores da coleção"] },
    ],
  },
  {
    ext: "demo_c_5", name: "[Vendas] Teste · Público frio amplo", objective: "OUTCOME_SALES", kind: "sales_bad", dailySpend: 95, cpm: 19, ctr: 0.006, cvr: 0.0, aov: 0, startDay: 20, trend: 0, status: "ACTIVE",
    adSets: [{ name: "Amplo 18-65", ads: ["Estático · Teste A", "Estático · Teste B"] }],
  },
  {
    ext: "demo_c_6", name: "[Cadastros] Lista VIP Black Friday", objective: "OUTCOME_LEADS", kind: "leads", dailySpend: 180, cpm: 17, ctr: 0.016, cvr: 0.18, aov: 0, startDay: 60, trend: 0.08,
    adSets: [{ name: "Formulário instantâneo", ads: ["Formulário · Acesso antecipado", "Vídeo · O que vem aí"] }],
  },
  {
    ext: "demo_c_7", name: "[Mensagens] WhatsApp · Atendimento", objective: "OUTCOME_ENGAGEMENT", kind: "messaging", dailySpend: 140, cpm: 15, ctr: 0.019, cvr: 0.22, aov: 0, startDay: 90, trend: 0, destination: "WHATSAPP",
    adSets: [{ name: "Clique para WhatsApp", ads: ["Estático · Fale com uma consultora", "Vídeo · Tire suas dúvidas"] }],
  },
  {
    ext: "demo_c_8", name: "[Reconhecimento] Marca · Alcance", objective: "OUTCOME_AWARENESS", kind: "awareness", dailySpend: 110, cpm: 6.5, ctr: 0.004, cvr: 0, aov: 0, startDay: 140, trend: 0, status: "PAUSED",
    adSets: [{ name: "Alcance Sudeste", ads: ["Vídeo 6s · Manifesto"] }],
  },
];

const PALETTES = [
  ["#1f3a5f", "#e8b15b", "#f4efe6"],
  ["#2d4739", "#d88c5a", "#f1ebe1"],
  ["#452b3f", "#e6a4a4", "#f7efe9"],
  ["#223843", "#7fb7be", "#efe9df"],
  ["#3b3024", "#c9a66b", "#f3ede3"],
  ["#1d2b3a", "#9fb4d1", "#eef1f5"],
];

/** Miniatura abstrata original (SVG) - não imita marcas nem obras existentes. */
function demoThumb(i: number, label: string) {
  const [a, b, c] = PALETTES[i % PALETTES.length];
  const shape = i % 3;
  const art =
    shape === 0
      ? `<circle cx="300" cy="210" r="120" fill="${b}"/><rect x="80" y="300" width="300" height="140" rx="18" fill="${c}" opacity=".9"/>`
      : shape === 1
        ? `<path d="M0 360 C120 260 260 420 480 300 L480 480 L0 480Z" fill="${b}"/><circle cx="130" cy="150" r="70" fill="${c}"/>`
        : `<rect x="60" y="60" width="200" height="260" rx="100" fill="${b}"/><rect x="220" y="180" width="200" height="240" rx="24" fill="${c}" opacity=".85"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480"><rect width="480" height="480" fill="${a}"/>${art}<text x="28" y="452" font-family="system-ui,sans-serif" font-size="22" fill="${c}" opacity=".85">${label.replace(/[<&>]/g, "")}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export async function createDemoWorkspace(userId: string, opts: { name?: string; seed?: number; now?: Date } = {}) {
  const db = getDb();
  const ws = await createWorkspace(userId, opts.name ?? "Demonstração · Casa Lumi", { isDemo: true });
  await db
    .update(schema.workspaces)
    .set({ settings: { roasTarget: 3, cpaTarget: 85, rankingMinResults: 3, syncIntervalMinutes: 15 } })
    .where(eq(schema.workspaces.id, ws.id));
  await seedDemoData(ws.id, opts.seed ?? 42, opts.now ?? new Date());
  return ws;
}

export async function seedDemoData(workspaceId: string, seed: number, now: Date) {
  const db = getDb();
  const rand = rng(seed);
  const tz = "America/Sao_Paulo";
  const today = todayInTimezone(tz, now);
  const HISTORY = 150;

  const [acc] = await db
    .insert(schema.adAccounts)
    .values({
      workspaceId,
      provider: "meta",
      externalId: "demo_act_1001",
      name: "Casa Lumi · Loja online",
      currency: "BRL",
      timezoneName: tz,
      accountStatus: 1,
      businessName: "Casa Lumi (fictícia)",
      isSelected: true,
      syncStatus: "ok",
      lastSuccessfulSyncAt: new Date(now.getTime() - 4 * 60_000),
      lastSyncStartedAt: new Date(now.getTime() - 5 * 60_000),
      initialSyncCompletedAt: new Date(now.getTime() - 20 * 86400_000),
      dataFrom: addDays(today, -(HISTORY - 1)),
      dataThrough: today,
    })
    .returning();

  const rows: Array<typeof schema.insightsDaily.$inferInsert> = [];
  const placements = new Map<string, typeof schema.insightsPlacementDaily.$inferInsert>();
  const present = new Set<string>();
  const rawRows: Array<{ base: Omit<typeof schema.insightsDaily.$inferInsert, "purchases">; actions: Record<string, number>; values: Record<string, number>; campaignId: string }> = [];
  // Fração do dia já decorrida no fuso da conta: "hoje" é parcial.
  const hourNow = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(now)) % 24;
  const todayFraction = Math.max(0.08, hourNow / 24);

  let adIndex = 0;
  for (const spec of CAMPAIGNS) {
    const [camp] = await db
      .insert(schema.campaigns)
      .values({
        workspaceId,
        adAccountId: acc.id,
        externalId: spec.ext,
        name: spec.name,
        objective: spec.objective,
        status: spec.status ?? "ACTIVE",
        effectiveStatus: spec.status ?? "ACTIVE",
        buyingType: "AUCTION",
        dailyBudget: String(spec.dailySpend),
        createdTime: new Date(now.getTime() - spec.startDay * 86400_000),
      })
      .returning();
    const totalAds = spec.adSets.reduce((s, x) => s + x.ads.length, 0);
    let si = 0;
    for (const setSpec of spec.adSets) {
      const [set] = await db
        .insert(schema.adSets)
        .values({
          workspaceId,
          adAccountId: acc.id,
          campaignId: camp.id,
          externalId: `${spec.ext}_s${si}`,
          name: setSpec.name,
          status: spec.status ?? "ACTIVE",
          effectiveStatus: spec.status ?? "ACTIVE",
          optimizationGoal: spec.kind === "messaging" ? "CONVERSATIONS" : spec.kind === "leads" ? "LEAD_GENERATION" : spec.kind === "awareness" ? "REACH" : "OFFSITE_CONVERSIONS",
          destinationType: spec.destination ?? (spec.kind === "leads" ? "ON_AD" : "WEBSITE"),
          attributionSpec: [{ event_type: "CLICK_THROUGH", window_days: 7 }, { event_type: "VIEW_THROUGH", window_days: 1 }],
        })
        .returning();
      si++;
      for (const adName of setSpec.ads) {
        const quality = 0.55 + rand() * 0.9; // eficiência relativa do criativo
        const weight = (0.5 + rand()) / totalAds;
        const isVideo = /vídeo|reels|ugc/i.test(adName);
        const [ad] = await db
          .insert(schema.ads)
          .values({
            workspaceId,
            adAccountId: acc.id,
            campaignId: camp.id,
            adSetId: set.id,
            externalId: `${spec.ext}_a${adIndex}`,
            name: adName,
            status: spec.status ?? (rand() < 0.15 ? "PAUSED" : "ACTIVE"),
            effectiveStatus: spec.status ?? "ACTIVE",
            creative: {
              creativeId: `demo_cr_${adIndex}`,
              thumbnailUrl: demoThumb(adIndex, adName.split("·")[0].trim()),
              objectType: isVideo ? "VIDEO" : "SHARE",
              isVideo,
              title: adName,
              body: "Texto de anúncio fictício do modo demonstração.",
              linkUrl: null,
            },
            previewShareableLink: null,
          })
          .returning();
        adIndex++;

        for (let back = HISTORY - 1; back >= 0; back--) {
          if (back > spec.startDay) continue;
          const date = addDays(today, -back);
          const dow = new Date(date + "T12:00:00Z").getUTCDay();
          const season = [1.12, 0.92, 0.95, 0.97, 1.0, 1.05, 1.18][dow];
          const progress = 1 - back / Math.max(1, spec.startDay);
          const trendF = 1 + spec.trend * progress * (spec.trend < 0 ? 1.4 : 1);
          const partial = back === 0 ? todayFraction : 1;
          const noise = () => 0.8 + rand() * 0.4;
          const spend = +(spec.dailySpend * weight * season * noise() * partial * (spec.status === "PAUSED" && back < 12 ? 0 : 1)).toFixed(2);
          if (spend <= 0) continue;
          const impressions = Math.round((spend / (spec.cpm * noise())) * 1000);
          const clicks = Math.round(impressions * spec.ctr * quality ** 0.5 * noise());
          const lpv = Math.round(clicks * (0.72 + rand() * 0.12));
          const eff = quality * trendF;
          const actions: Array<{ action_type: string; value: number }> = [];
          const values: Array<{ action_type: string; value: number }> = [];
          if (spec.kind === "sales" || spec.kind === "sales_bad") {
            const atc = Math.round(lpv * 0.1 * eff * noise());
            const ic = Math.round(atc * 0.52 * noise());
            let purchases = spec.kind === "sales_bad" ? 0 : Math.round(clicks * spec.cvr * eff * noise());
            if (purchases > ic && ic > 0) purchases = Math.max(purchases - 1, ic); // conversões de visualização podem exceder checkouts
            const value = +(purchases * spec.aov * (0.85 + rand() * 0.3)).toFixed(2);
            actions.push(
              { action_type: "omni_landing_page_view", value: lpv },
              { action_type: "landing_page_view", value: lpv },
              { action_type: "omni_add_to_cart", value: atc },
              { action_type: "offsite_conversion.fb_pixel_add_to_cart", value: atc },
              { action_type: "omni_initiated_checkout", value: ic },
              { action_type: "offsite_conversion.fb_pixel_initiate_checkout", value: ic },
            );
            if (purchases > 0) {
              // Tipos sobrepostos, como a Meta devolve - o motor usa só omni_purchase.
              actions.push({ action_type: "omni_purchase", value: purchases }, { action_type: "purchase", value: purchases }, { action_type: "offsite_conversion.fb_pixel_purchase", value: purchases });
              values.push({ action_type: "omni_purchase", value }, { action_type: "purchase", value }, { action_type: "offsite_conversion.fb_pixel_purchase", value });
            }
          } else if (spec.kind === "leads") {
            const leads = Math.round(clicks * spec.cvr * eff * noise());
            actions.push({ action_type: "lead", value: leads }, { action_type: "onsite_conversion.lead_grouped", value: leads }, { action_type: "omni_landing_page_view", value: Math.round(lpv * 0.2) });
          } else if (spec.kind === "messaging") {
            const conv = Math.round(clicks * spec.cvr * eff * noise());
            actions.push({ action_type: "onsite_conversion.messaging_conversation_started_7d", value: conv });
          }
          for (const a of actions) if (a.value > 0) present.add(a.action_type);
          const actionRec = actionListToRecord(actions.filter((a) => a.value > 0));
          const valueRec = actionListToRecord(values);
          rawRows.push({
            base: {
              workspaceId,
              adAccountId: acc.id,
              campaignId: camp.id,
              adSetId: set.id,
              adId: ad.id,
              date,
              spend: String(spend),
              impressions,
              linkClicks: clicks,
              actions: actionRec,
              actionValues: valueRec,
            },
            actions: actionRec,
            values: valueRec,
            campaignId: camp.id,
          });
        }
      }
    }
  }

  const map = chooseActionTypeMap(present);
  await db.update(schema.adAccounts).set({ actionTypeMap: map }).where(eq(schema.adAccounts.id, acc.id));
  const splits: Array<[string, string, number]> = [
    ["instagram", "feed", 0.31],
    ["instagram", "reels", 0.22],
    ["instagram", "story", 0.14],
    ["facebook", "feed", 0.21],
    ["facebook", "facebook_reels", 0.05],
    ["audience_network", "classic", 0.03],
    ["messenger", "messenger_inbox", 0.04],
  ];
  for (const r of rawRows) {
    const ex = extractAll(r.actions, r.values, map);
    rows.push({
      ...r.base,
      purchases: String(ex.purchases),
      purchaseValue: String(ex.purchaseValue),
      leads: String(ex.leads),
      messagingConversations: String(ex.messagingConversations),
      landingPageViews: String(ex.landingPageViews),
      addToCart: String(ex.addToCart),
      initiateCheckout: String(ex.initiateCheckout),
    });
    if (r.base.date! >= addDays(today, -89)) {
      for (const [platform, position, share] of splits) {
        const k = `${r.campaignId}|${r.base.date}|${platform}|${position}`;
        const eff = platform === "audience_network" ? 0.35 : position === "reels" ? 1.15 : 1;
        const prev = placements.get(k);
        const add = {
          spend: Number(r.base.spend) * share,
          impressions: Math.round(Number(r.base.impressions) * share * (platform === "audience_network" ? 1.8 : 1)),
          linkClicks: Math.round(Number(r.base.linkClicks) * share),
          purchases: Math.round(ex.purchases * share * eff * 100) / 100,
          purchaseValue: ex.purchaseValue * share * eff,
        };
        placements.set(k, {
          workspaceId,
          adAccountId: acc.id,
          campaignId: r.campaignId,
          date: r.base.date!,
          publisherPlatform: platform,
          platformPosition: position,
          spend: String(+(Number(prev?.spend ?? 0) + add.spend).toFixed(4)),
          impressions: Number(prev?.impressions ?? 0) + add.impressions,
          linkClicks: Number(prev?.linkClicks ?? 0) + add.linkClicks,
          purchases: String(Number(prev?.purchases ?? 0) + add.purchases),
          purchaseValue: String(+(Number(prev?.purchaseValue ?? 0) + add.purchaseValue).toFixed(4)),
          actions: {},
          actionValues: {},
        });
      }
    }
  }
  for (let i = 0; i < rows.length; i += 1000) await db.insert(schema.insightsDaily).values(rows.slice(i, i + 1000));
  const pl = [...placements.values()];
  for (let i = 0; i < pl.length; i += 1000) await db.insert(schema.insightsPlacementDaily).values(pl.slice(i, i + 1000));

  // Alcance exato por período (não somado): impressões ÷ frequência plausível para a duração.
  for (const p of reachPeriods(today)) {
    const inRange = rows.filter((r) => r.date! >= p.from && r.date! <= p.to);
    const imp = inRange.reduce((s, r) => s + Number(r.impressions), 0);
    if (!imp) continue;
    const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400_000) + 1;
    const freq = 1.35 + Math.log10(days + 1) * 1.05;
    await db.insert(schema.reachSnapshots).values({ workspaceId, adAccountId: acc.id, level: "account", objectExternalId: acc.externalId, dateFrom: p.from, dateTo: p.to, reach: Math.round(imp / freq), frequency: freq.toFixed(4), impressions: imp });
  }

  await db.insert(schema.syncJobs).values({ adAccountId: acc.id, workspaceId, enabled: false, intervalMinutes: 15, nextRunAt: new Date(now.getTime() + 11 * 60_000) });
  const runs = Array.from({ length: 8 }, (_, i) => {
    const started = new Date(now.getTime() - (5 + i * 15) * 60_000);
    return {
      workspaceId,
      adAccountId: acc.id,
      kind: (i === 7 ? "manual" : "incremental") as "manual" | "incremental",
      status: (i === 3 ? "failed" : "succeeded") as "failed" | "succeeded",
      dateFrom: addDays(today, -7),
      dateTo: today,
      progress: 1,
      rowsUpserted: i === 3 ? 0 : 180 + Math.round(rand() * 40),
      apiCalls: i === 3 ? 3 : 19 + Math.round(rand() * 5),
      errorCode: i === 3 ? "meta_rate_limit_80000" : null,
      errorMessage: i === 3 ? "A Meta limitou temporariamente as consultas. Nova tentativa agendada automaticamente. (simulado)" : null,
      createdAt: started,
      startedAt: started,
      finishedAt: new Date(started.getTime() + (40 + Math.round(rand() * 30)) * 1000),
    };
  });
  await db.insert(schema.syncRuns).values(runs);

  await db.insert(schema.funnels).values({
    workspaceId,
    adAccountId: acc.id,
    name: "E-commerce · todas as campanhas de vendas",
    kind: "ecommerce",
    stages: [
      { key: "imp", label: "Impressões", metric: "impressions" },
      { key: "clk", label: "Cliques no link", metric: "link_clicks" },
      { key: "lpv", label: "Visualizações da página", metric: "landing_page_views" },
      { key: "atc", label: "Adições ao carrinho", metric: "add_to_cart" },
      { key: "ic", label: "Checkouts iniciados", metric: "initiate_checkout" },
      { key: "pur", label: "Compras", metric: "purchases" },
    ],
    campaignIds: (await db.select({ id: schema.campaigns.id, ext: schema.campaigns.externalId }).from(schema.campaigns).where(eq(schema.campaigns.adAccountId, acc.id)))
      .filter((c) => ["demo_c_1", "demo_c_2", "demo_c_3", "demo_c_4", "demo_c_5"].includes(c.ext))
      .map((c) => c.id),
  });
  return acc;
}
