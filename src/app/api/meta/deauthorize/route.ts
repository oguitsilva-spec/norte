import { NextResponse, type NextRequest } from "next/server";
import { parseSignedRequest } from "@/server/providers/meta/api";
import { revokeByExternalUser } from "@/server/providers/meta/connection";
import { log } from "@/server/security/redact";

/** Callback de desautorização (configurado no painel do app Meta). */
export async function POST(req: NextRequest) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const form = await req.formData();
  const payload = parseSignedRequest(String(form.get("signed_request") ?? ""), secret);
  if (!payload?.user_id) return NextResponse.json({ error: "invalid_signed_request" }, { status: 400 });
  const n = await revokeByExternalUser(String(payload.user_id), "deauthorized");
  log.info("meta_deauthorized", { connections: n });
  return NextResponse.json({ ok: true });
}
