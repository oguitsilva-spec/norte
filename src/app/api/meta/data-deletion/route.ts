import { NextResponse, type NextRequest } from "next/server";
import { parseSignedRequest } from "@/server/providers/meta/api";
import { revokeByExternalUser } from "@/server/providers/meta/connection";
import { randomToken } from "@/server/security/crypto";
import { log } from "@/server/security/redact";

/**
 * Callback de exclusão de dados exigido pela Meta. Remove conexões e todo o
 * histórico sincronizado do usuário e devolve URL + código de confirmação.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const form = await req.formData();
  const payload = parseSignedRequest(String(form.get("signed_request") ?? ""), secret);
  if (!payload?.user_id) return NextResponse.json({ error: "invalid_signed_request" }, { status: 400 });
  const n = await revokeByExternalUser(String(payload.user_id), "data_deletion");
  const code = randomToken(9);
  log.info("meta_data_deletion", { connections: n, code });
  return NextResponse.json({ url: `${process.env.APP_URL}/exclusao-de-dados?codigo=${code}`, confirmation_code: code });
}
