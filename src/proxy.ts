import { NextResponse, type NextRequest } from "next/server";

/**
 * Checagem otimista: sem cookie de sessão, manda para o login. A autorização
 * real (sessão válida + participação no workspace) acontece no servidor em
 * cada página, ação e rota de API.
 */
export function proxy(req: NextRequest) {
  const has = req.cookies.getAll().some((c) => c.name.endsWith("norte.session_token"));
  if (!has) {
    const url = new URL("/entrar", req.url);
    url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/w/:path*", "/app"] };
