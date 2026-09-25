/**
 * Classificação dos erros da Graph API / Marketing API.
 * Referências (verificadas em set/2026):
 *  - 190: token inválido/expirado (subcódigos 458 app removido, 460 senha alterada,
 *         463 expirado, 467 sessão inválida, 492 sessão inválida)
 *  - 10, 200-299: permissão negada / permissão não concedida
 *  - 4, 17, 32, 613: limite de requisições (app, usuário, página, customizado)
 *  - 80000-80014: limites de uso por caso de negócio (BUC); 80000 = ads_insights
 *  - 1, 2: erro temporário / serviço indisponível
 */
export type MetaErrorKind = "auth" | "permission" | "rate_limit" | "transient" | "invalid_request" | "unknown";

export class MetaApiError extends Error {
  constructor(
    public kind: MetaErrorKind,
    message: string,
    public code?: number,
    public subcode?: number,
    public httpStatus?: number,
    /** Sugestão de espera (ms) antes de nova tentativa, a partir dos cabeçalhos de uso. */
    public retryAfterMs?: number,
    public fbtraceId?: string,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
  get retryable() {
    return this.kind === "rate_limit" || this.kind === "transient";
  }
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

export function classifyMetaError(
  err: { code?: number; error_subcode?: number; message?: string; is_transient?: boolean },
  httpStatus?: number,
): MetaErrorKind {
  const code = err.code ?? 0;
  if (code === 190 || code === 102) return "auth";
  if (code === 10 || (code >= 200 && code <= 299)) return "permission";
  if (RATE_LIMIT_CODES.has(code) || (code >= 80000 && code <= 80014)) return "rate_limit";
  if (err.is_transient || code === 1 || code === 2 || (httpStatus !== undefined && httpStatus >= 500)) return "transient";
  if (code === 100) return "invalid_request";
  return "unknown";
}

/** Mensagem em pt-BR para exibir na interface (sem detalhes sensíveis). */
export function userMessageFor(e: MetaApiError): string {
  switch (e.kind) {
    case "auth":
      if (e.subcode === 460) return "A senha do Facebook foi alterada e a autorização foi invalidada. Reconecte a Meta.";
      if (e.subcode === 458) return "O aplicativo foi removido nas configurações do Facebook. Reconecte a Meta.";
      if (e.subcode === 463) return "A autorização da Meta expirou. Reconecte para retomar a sincronização.";
      return "A autorização da Meta não é mais válida. Reconecte para retomar a sincronização.";
    case "permission":
      return "A Meta negou acesso a esta conta de anúncios. Verifique se você ainda tem acesso a ela no Gerenciador de Negócios e se a permissão ads_read foi concedida.";
    case "rate_limit":
      return "A Meta limitou temporariamente as consultas. A sincronização será retomada automaticamente.";
    case "transient":
      return "A Meta está instável no momento. Tentaremos novamente em instantes.";
    default:
      return "Erro inesperado ao consultar a Meta.";
  }
}
