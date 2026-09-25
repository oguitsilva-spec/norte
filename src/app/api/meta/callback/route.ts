import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/server/tenancy/access";
import { handleMetaCallback, metaAppConfig, NONCE_COOKIE } from "@/server/providers/meta/connection";

/**
 * Retorno do Facebook Login for Business. O code é trocado no servidor;
 * nada sensível é repassado ao navegador. A URL de retorno não carrega o token.
 */
export async function GET(req: NextRequest) {
  const appUrl = process.env.APP_URL ?? req.nextUrl.origin;
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/entrar?next=/app", appUrl));
  const cfg = metaAppConfig();
  if (!cfg) return NextResponse.redirect(new URL("/app?erro=meta_nao_configurada", appUrl));
  const jar = await cookies();
  const nonce = jar.get(NONCE_COOKIE)?.value ?? null;
  const sp = req.nextUrl.searchParams;
  const result = await handleMetaCallback(
    cfg,
    { code: sp.get("code"), state: sp.get("state"), error: sp.get("error"), errorReason: sp.get("error_reason") },
    nonce,
    user.id,
  );
  const res = (path: string) => {
    const r = NextResponse.redirect(new URL(path, appUrl));
    r.cookies.set(NONCE_COOKIE, "", { path: "/api/meta/callback", maxAge: 0 });
    return r;
  };
  if (result.ok) return res(`/w/${result.workspaceId}/conexoes/meta/contas?conexao=${result.connectionId}`);
  if (!result.workspaceId) return res("/app?erro=estado_invalido");
  return res(`/w/${result.workspaceId}/conexoes?erro=${result.error}`);
}
