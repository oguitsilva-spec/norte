import "server-only";
import { z } from "zod";

/**
 * Validated server-side configuration. Never import this from client code.
 * Missing Meta credentials are allowed: the app then runs with the Meta
 * connection marked as "não configurada" and only demo mode is available.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET precisa ter pelo menos 32 caracteres"),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "TOKEN_ENCRYPTION_KEY deve ser 32 bytes em base64"),

  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_LOGIN_CONFIG_ID: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),

  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(120).default(15),
  SYNC_INITIAL_HISTORY_DAYS: z.coerce.number().int().min(7).max(1095).default(90),
  SYNC_RECONCILIATION_DAYS: z.coerce.number().int().min(1).max(28).default(7),
  MANUAL_REFRESH_COOLDOWN_SECONDS: z.coerce.number().int().min(30).default(120),

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Norte <nao-responda@norte.local>"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Configuração inválida: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function metaConfigured(): boolean {
  const e = env();
  return Boolean(e.META_APP_ID && e.META_APP_SECRET && e.META_LOGIN_CONFIG_ID);
}
