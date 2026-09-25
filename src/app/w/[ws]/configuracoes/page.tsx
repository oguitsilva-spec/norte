import { and, asc, eq, isNull, gt } from "drizzle-orm";
import { loadPage } from "@/server/page-context";
import { getDb, schema } from "@/server/db";
import { revokeInviteAction } from "@/server/actions/workspace";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SettingsForm, InviteForm, MemberActions } from "@/components/dashboard/settings-forms";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Configurações" };
const ROLE: Record<string, string> = { owner: "Proprietário", admin: "Administrador", viewer: "Leitor" };

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ws } = await params;
  const data = await loadPage(ws, await searchParams);
  const { ctx } = data;
  const db = getDb();
  const members = await db
    .select({ userId: schema.memberships.userId, role: schema.memberships.role, name: schema.user.name, email: schema.user.email, since: schema.memberships.createdAt })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(eq(schema.memberships.workspaceId, ctx.workspaceId))
    .orderBy(asc(schema.memberships.createdAt));
  const invites = await db
    .select()
    .from(schema.invitations)
    .where(and(eq(schema.invitations.workspaceId, ctx.workspaceId), isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt), gt(schema.invitations.expiresAt, new Date())));
  const isAdmin = ctx.role !== "viewer";
  const currency = data.account?.currency ?? "BRL";
  return (
    <>
      <PageHeader data={data} title="Configurações" description="Metas, critérios de ranking, sincronização e acesso ao workspace." showFilters={false} />
      <main className="flex flex-col gap-5 px-4 py-6 sm:px-8">
        <Card>
          <CardHeader title="Metas e critérios" description={isAdmin ? "Valores na moeda da conta selecionada." : "Somente administradores podem alterar estas configurações."} />
          <div className="px-5 pb-6 pt-5">
            <SettingsForm ws={ws} disabled={!isAdmin} currency={currency} v={{ name: ctx.workspaceName, ...ctx.settings }} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Pessoas com acesso" description="Proprietários e administradores gerenciam conexões e configurações. Leitores só visualizam." />
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-[13px] font-semibold text-ink-2 ring-1 ring-line">{m.name.slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-ink">
                    {m.name} {m.userId === ctx.userId ? <span className="text-ink-3">(você)</span> : null}
                  </p>
                  <p className="text-[12.5px] text-ink-3">{m.email}</p>
                </div>
                {isAdmin && (ctx.role === "owner" || m.role !== "owner") ? (
                  <MemberActions ws={ws} userId={m.userId} role={m.role} canManage isSelf={m.userId === ctx.userId} />
                ) : (
                  <Badge>{ROLE[m.role]}</Badge>
                )}
              </li>
            ))}
          </ul>
          {isAdmin ? (
            <div className="border-t border-line px-5 py-5">
              <p className="mb-3 text-[14px] font-semibold text-ink">Convidar pessoa</p>
              <InviteForm ws={ws} />
              {invites.length ? (
                <ul className="mt-5 flex flex-col gap-2">
                  {invites.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-[10px] bg-surface-2 px-3 py-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate text-ink">{i.email}</span>
                      <Badge>{ROLE[i.role]}</Badge>
                      <span className="text-ink-3">expira em {fmtDate(i.expiresAt.toISOString().slice(0, 10))}</span>
                      <form action={revokeInviteAction.bind(null, ws, i.id)}>
                        <button className="text-[13px] font-medium text-critical hover:underline">Revogar</button>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </Card>
      </main>
    </>
  );
}
