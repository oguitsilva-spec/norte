/**
 * Remove segredos de strings/objetos antes de logar ou persistir mensagens de erro.
 * Cobre tokens da Meta (EAA…), parâmetros sensíveis em URLs e campos conhecidos.
 */
const SENSITIVE_KEYS = /^(access_token|client_secret|appsecret_proof|fb_exchange_token|code|token|password|secret|input_token|authorization|cookie)$/i;

export function redactString(s: string): string {
  return s
    .replace(/EAA[A-Za-z0-9]{10,}/g, "EAA***")
    .replace(
      /([?&](?:access_token|client_secret|appsecret_proof|fb_exchange_token|code|input_token)=)[^&\s"']+/gi,
      "$1***",
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1***");
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 6) return "[…]" as unknown as T;
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? "***" : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

export const log = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(JSON.stringify({ level: "info", msg: redactString(msg), ...(meta ? redact(meta) : {}), ts: new Date().toISOString() })),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    console.warn(JSON.stringify({ level: "warn", msg: redactString(msg), ...(meta ? redact(meta) : {}), ts: new Date().toISOString() })),
  error: (msg: string, meta?: Record<string, unknown>) =>
    console.error(JSON.stringify({ level: "error", msg: redactString(msg), ...(meta ? redact(meta) : {}), ts: new Date().toISOString() })),
};
