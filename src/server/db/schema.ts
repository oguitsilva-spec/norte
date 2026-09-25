import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  uuid,
  integer,
  bigint,
  numeric,
  jsonb,
  date,
  primaryKey,
  uniqueIndex,
  index,
  real,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ------------------------------------------------------------------ */
/* Autenticação do SaaS (tabelas exigidas pelo Better Auth)            */
/* Separadas por completo da autorização da Meta.                      */
/* ------------------------------------------------------------------ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Workspaces e acesso                                                 */
/* ------------------------------------------------------------------ */

export const roleEnum = pgEnum("workspace_role", ["owner", "admin", "viewer"]);

export type WorkspaceSettings = {
  roasTarget?: number | null;
  cpaTarget?: number | null;
  /** Gasto mínimo (na moeda da conta) para um anúncio entrar no ranking. */
  rankingMinSpend?: number | null;
  /** Mínimo de resultados (compras, leads…) para um anúncio entrar no ranking. */
  rankingMinResults?: number | null;
  syncIntervalMinutes?: number | null;
};

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
  settings: jsonb("settings").$type<WorkspaceSettings>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    /** Seleção persistente da conta de anúncios por usuário e workspace. */
    selectedAdAccountId: uuid("selected_ad_account_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("memberships_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: roleEnum("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invitations_ws_idx").on(t.workspaceId)],
);

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  activeWorkspaceId: uuid("active_workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Conexões com provedores (Meta)                                      */
/* ------------------------------------------------------------------ */

export const providerEnum = pgEnum("provider", ["meta"]);
export const connectionStatusEnum = pgEnum("connection_status", [
  "active",
  "expired",
  "revoked",
  "permission_denied",
  "error",
  "disconnected",
]);

export const providerConnections = pgTable(
  "provider_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    /** ID do usuário (app-scoped) ou do system user que autorizou. */
    externalUserId: text("external_user_id").notNull(),
    externalUserName: text("external_user_name"),
    /** "user" (token de usuário de longa duração) ou "system_user" (Business Integration SUAT). */
    tokenType: text("token_type").notNull(),
    /** Token criptografado com AES-256-GCM (formato v1:iv:tag:ciphertext). Nunca enviado ao navegador. */
    tokenCiphertext: text("token_ciphertext"),
    grantedScopes: text("granted_scopes").array().notNull().default(sql`'{}'::text[]`),
    declinedScopes: text("declined_scopes").array().notNull().default(sql`'{}'::text[]`),
    /** null = a Meta não informou expiração (ex.: SUAT sem prazo). */
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    dataAccessExpiresAt: timestamp("data_access_expires_at", { withTimezone: true }),
    status: connectionStatusEnum("status").notNull().default("active"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("provider_connections_unique").on(t.workspaceId, t.provider, t.externalUserId),
    index("provider_connections_external_idx").on(t.provider, t.externalUserId),
  ],
);

/** Estado do OAuth: guardado como hash, uso único, expira em 10 minutos. */
export const oauthStates = pgTable("oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  provider: providerEnum("provider").notNull(),
  /** Vínculo do estado com a sessão do navegador (hash do cookie nonce). */
  browserNonceHash: text("browser_nonce_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Contas de anúncios e estrutura                                      */
/* ------------------------------------------------------------------ */

export const accountSyncStatusEnum = pgEnum("account_sync_status", [
  "pending",
  "initial_sync",
  "ok",
  "error",
  "permission_denied",
  "paused",
]);

/** Tipos de ação canônicos escolhidos por conta (nunca somados entre si). */
export type ActionTypeMap = Partial<
  Record<"purchase" | "lead" | "messaging" | "landing_page_view" | "add_to_cart" | "initiate_checkout", string | null>
>;

export const adAccounts = pgTable(
  "ad_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").references(() => providerConnections.id, { onDelete: "set null" }),
    provider: providerEnum("provider").notNull(),
    /** ID estável da Meta, no formato act_<id>. */
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    timezoneName: text("timezone_name").notNull(),
    accountStatus: integer("account_status"),
    businessName: text("business_name"),
    /** A conta está selecionada para sincronização. */
    isSelected: boolean("is_selected").notNull().default(false),
    actionTypeMap: jsonb("action_type_map").$type<ActionTypeMap>().notNull().default({}),
    syncStatus: accountSyncStatusEnum("sync_status").notNull().default("pending"),
    syncProgress: real("sync_progress"),
    lastSyncStartedAt: timestamp("last_sync_started_at", { withTimezone: true }),
    lastSuccessfulSyncAt: timestamp("last_successful_sync_at", { withTimezone: true }),
    initialSyncCompletedAt: timestamp("initial_sync_completed_at", { withTimezone: true }),
    /** Último dia (no fuso da conta) coberto pela sincronização. */
    dataThrough: date("data_through"),
    /** Primeiro dia importado. */
    dataFrom: date("data_from"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ad_accounts_unique").on(t.workspaceId, t.provider, t.externalId),
    index("ad_accounts_ws_idx").on(t.workspaceId),
  ],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    objective: text("objective"),
    status: text("status"),
    effectiveStatus: text("effective_status"),
    buyingType: text("buying_type"),
    dailyBudget: numeric("daily_budget", { precision: 18, scale: 2 }),
    lifetimeBudget: numeric("lifetime_budget", { precision: 18, scale: 2 }),
    createdTime: timestamp("created_time", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("campaigns_unique").on(t.adAccountId, t.externalId), index("campaigns_ws_idx").on(t.workspaceId)],
);

export const adSets = pgTable(
  "ad_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    status: text("status"),
    effectiveStatus: text("effective_status"),
    optimizationGoal: text("optimization_goal"),
    destinationType: text("destination_type"),
    /** attribution_spec do conjunto - base da "configuração de atribuição unificada". */
    attributionSpec: jsonb("attribution_spec"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ad_sets_unique").on(t.adAccountId, t.externalId), index("ad_sets_campaign_idx").on(t.campaignId)],
);

export type CreativeInfo = {
  creativeId?: string | null;
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  objectType?: string | null;
  title?: string | null;
  body?: string | null;
  linkUrl?: string | null;
  instagramPermalinkUrl?: string | null;
  isVideo?: boolean;
};

export const ads = pgTable(
  "ads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    adSetId: uuid("ad_set_id").notNull().references(() => adSets.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    status: text("status"),
    effectiveStatus: text("effective_status"),
    creative: jsonb("creative").$type<CreativeInfo>().notNull().default({}),
    previewShareableLink: text("preview_shareable_link"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ads_unique").on(t.adAccountId, t.externalId), index("ads_adset_idx").on(t.adSetId)],
);

/* ------------------------------------------------------------------ */
/* Métricas                                                            */
/* ------------------------------------------------------------------ */

/**
 * Grão: 1 linha por anúncio por dia (no fuso da conta), atribuição
 * "unificada" (configuração de cada conjunto de anúncios), action_report_time
 * = impression (padrão da API). Apenas métricas ADITIVAS são armazenadas aqui.
 * Alcance/frequência NÃO são somáveis e vivem em `reach_snapshots`.
 */
export const insightsDaily = pgTable(
  "insights_daily",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    adSetId: uuid("ad_set_id").notNull().references(() => adSets.id, { onDelete: "cascade" }),
    adId: uuid("ad_id").notNull().references(() => ads.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    spend: numeric("spend", { precision: 18, scale: 4 }).notNull().default("0"),
    impressions: bigint("impressions", { mode: "number" }).notNull().default(0),
    linkClicks: bigint("link_clicks", { mode: "number" }).notNull().default(0),
    /** Ações brutas {action_type: valor} - preservadas para reprocessamento. */
    actions: jsonb("actions").$type<Record<string, number>>().notNull().default({}),
    actionValues: jsonb("action_values").$type<Record<string, number>>().notNull().default({}),
    /** Extraídos com o tipo canônico da conta (ad_accounts.action_type_map). */
    purchases: numeric("purchases", { precision: 18, scale: 4 }).notNull().default("0"),
    purchaseValue: numeric("purchase_value", { precision: 18, scale: 4 }).notNull().default("0"),
    leads: numeric("leads", { precision: 18, scale: 4 }).notNull().default("0"),
    messagingConversations: numeric("messaging_conversations", { precision: 18, scale: 4 }).notNull().default("0"),
    landingPageViews: numeric("landing_page_views", { precision: 18, scale: 4 }).notNull().default("0"),
    addToCart: numeric("add_to_cart", { precision: 18, scale: 4 }).notNull().default("0"),
    initiateCheckout: numeric("initiate_checkout", { precision: 18, scale: 4 }).notNull().default("0"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.adAccountId, t.adId, t.date] }),
    index("insights_daily_ws_account_date").on(t.workspaceId, t.adAccountId, t.date),
    index("insights_daily_campaign_date").on(t.campaignId, t.date),
  ],
);

/** Quebra por plataforma/posicionamento - nível de campanha, grão diário. */
export const insightsPlacementDaily = pgTable(
  "insights_placement_daily",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    publisherPlatform: text("publisher_platform").notNull(),
    platformPosition: text("platform_position").notNull(),
    spend: numeric("spend", { precision: 18, scale: 4 }).notNull().default("0"),
    impressions: bigint("impressions", { mode: "number" }).notNull().default(0),
    linkClicks: bigint("link_clicks", { mode: "number" }).notNull().default(0),
    purchases: numeric("purchases", { precision: 18, scale: 4 }).notNull().default("0"),
    purchaseValue: numeric("purchase_value", { precision: 18, scale: 4 }).notNull().default("0"),
    actions: jsonb("actions").$type<Record<string, number>>().notNull().default({}),
    actionValues: jsonb("action_values").$type<Record<string, number>>().notNull().default({}),
  },
  (t) => [
    primaryKey({ columns: [t.adAccountId, t.campaignId, t.date, t.publisherPlatform, t.platformPosition] }),
    index("insights_placement_ws_idx").on(t.workspaceId, t.adAccountId, t.date),
  ],
);

/**
 * Alcance e frequência para um intervalo EXATO (não somável entre dias ou
 * campanhas). Consultado na Meta para os períodos padrão do painel.
 */
export const reachSnapshots = pgTable(
  "reach_snapshots",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    /** "account" ou "campaign" */
    level: text("level").notNull(),
    /** external_id do objeto (act_… ou id da campanha) */
    objectExternalId: text("object_external_id").notNull(),
    dateFrom: date("date_from").notNull(),
    dateTo: date("date_to").notNull(),
    reach: bigint("reach", { mode: "number" }),
    frequency: numeric("frequency", { precision: 10, scale: 4 }),
    impressions: bigint("impressions", { mode: "number" }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.adAccountId, t.level, t.objectExternalId, t.dateFrom, t.dateTo] })],
);

/* ------------------------------------------------------------------ */
/* Funis                                                               */
/* ------------------------------------------------------------------ */

export type FunnelStage = {
  key: string;
  label: string;
  /** Métrica agregada usada na etapa. */
  metric:
    | "impressions"
    | "link_clicks"
    | "landing_page_views"
    | "add_to_cart"
    | "initiate_checkout"
    | "purchases"
    | "leads"
    | "messaging_conversations";
};

export const funnels = pgTable(
  "funnels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    stages: jsonb("stages").$type<FunnelStage[]>().notNull(),
    /** Vazio = todas as campanhas da conta. */
    campaignIds: uuid("campaign_ids").array().notNull().default(sql`'{}'::uuid[]`),
    adSetIds: uuid("ad_set_ids").array().notNull().default(sql`'{}'::uuid[]`),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("funnels_ws_idx").on(t.workspaceId, t.adAccountId)],
);

/**
 * Status de cada recomendação por workspace e conta. A chave é estável
 * (regra + entidade); sem linha = "nova". Nunca altera campanhas na Meta.
 */
export const recommendationStates = pgTable(
  "recommendation_states",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    recKey: text("rec_key").notNull(),
    status: text("status").$type<"reviewed" | "dismissed" | "snoozed">().notNull(),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.adAccountId, t.recKey] })],
);

/* ------------------------------------------------------------------ */
/* Sincronização                                                       */
/* ------------------------------------------------------------------ */

/** Agenda persistente por conta. O agendador enfileira quando next_run_at vence. */
export const syncJobs = pgTable("sync_jobs", {
  adAccountId: uuid("ad_account_id")
    .primaryKey()
    .references(() => adAccounts.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  intervalMinutes: integer("interval_minutes").notNull().default(15),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull().defaultNow(),
  lastEnqueuedAt: timestamp("last_enqueued_at", { withTimezone: true }),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastManualRequestAt: timestamp("last_manual_request_at", { withTimezone: true }),
  lastReachSnapshotAt: timestamp("last_reach_snapshot_at", { withTimezone: true }),
});

export const syncRunStatusEnum = pgEnum("sync_run_status", ["queued", "running", "succeeded", "failed", "partial"]);
export const syncRunKindEnum = pgEnum("sync_run_kind", ["initial", "incremental", "manual"]);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    kind: syncRunKindEnum("kind").notNull(),
    status: syncRunStatusEnum("status").notNull().default("queued"),
    triggeredBy: text("triggered_by").references(() => user.id, { onDelete: "set null" }),
    /** ID do job na fila (pg-boss) para rastreio. */
    queueJobId: text("queue_job_id"),
    attempt: integer("attempt").notNull().default(1),
    dateFrom: date("date_from"),
    dateTo: date("date_to"),
    progress: real("progress").notNull().default(0),
    rowsUpserted: integer("rows_upserted").notNull().default(0),
    apiCalls: integer("api_calls").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("sync_runs_account_idx").on(t.adAccountId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* E-mails (saída) - em desenvolvimento, sem SMTP, ficam aqui e no log  */
/* ------------------------------------------------------------------ */

export const mailOutbox = pgTable("mail_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
