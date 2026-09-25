import Link from "next/link";
import { and, eq, isNull, gt } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { sha256 } from "@/server/security/crypto";
import { getSessionUser } from "@/server/tenancy/access";
import { acceptInviteAction } from "@/server/actions/workspace";
import { Logo } from "@/components/brand/logo";
import { buttonClasses } from "@/components/ui/button";

export const metadata = { title: "Convite" };

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const user = await getSessionUser();
  const [inv] = await getDb()
    .select({ email: schema.invitations.email, role: schema.invitations.role, ws: schema.workspaces.name })
    .from(schema.invitations)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.invitations.workspaceId))
    .where(and(eq(schema.invitations.tokenHash, sha256(token)), isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt), gt(schema.invitations.expiresAt, new Date())));
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[480px] flex-col justify-center gap-5 px-5">
      <Logo />
      {!inv ? (
        <p className="text-[15px] text-ink-2">Este convite é inválido, já foi usado ou expirou.</p>
      ) : (
        <>
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">Convite para “{inv.ws}”</h1>
          <p className="text-[14.5px] text-ink-2">Você foi convidado como {inv.role === "admin" ? "administrador" : "leitor"}. O convite vale para {inv.email}.</p>
          {sp.erro === "email" ? <p className="text-[13.5px] text-critical">Entre com a conta {inv.email} para aceitar.</p> : null}
          {user ? (
            <form action={acceptInviteAction.bind(null, token)}>
              <button className={buttonClasses("primary", "lg")}>Aceitar convite</button>
            </form>
          ) : (
            <div className="flex gap-2">
              <Link href={`/entrar?next=/convite/${token}`} className={buttonClasses("primary", "lg")}>Entrar</Link>
              <Link href="/criar-conta" className={buttonClasses("secondary", "lg")}>Criar conta</Link>
            </div>
          )}
        </>
      )}
    </main>
  );
}
