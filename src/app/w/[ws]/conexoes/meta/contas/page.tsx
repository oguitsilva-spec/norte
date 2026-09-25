import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { guard } from "@/server/page-context";
import { requireWorkspace, isUuid } from "@/server/tenancy/access";
import { getDb, schema } from "@/server/db";
import { saveAccountSelectionAction } from "@/server/actions/meta";
import { buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { timezoneLabel } from "@/lib/format";

export const metadata = { title: "Escolher contas" };

const META_ACCOUNT_STATUS: Record<number, string> = { 1: "Ativa", 2: "Desativada", 3: "Pendência de pagamento", 7: "Em análise de risco", 8: "Liquidação pendente", 9: "Período de carência", 100: "Encerramento pendente", 101: "Encerrada" };

export default async function SelectAccountsPage({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<Record<string, string>> }) {
  const { ws } = await params;
  const sp = await searchParams;
  const ctx = await guard(() => requireWorkspace(ws, "admin"), ws);
  const connectionId = sp.conexao;
  if (!isUuid(connectionId)) redirect(`/w/${ws}/conexoes`);
  const db = getDb();
  const [conn] = await db.select().from(schema.providerConnections).where(and(eq(schema.providerConnections.id, connectionId), eq(schema.providerConnections.workspaceId, ctx.workspaceId)));
  if (!conn) redirect(`/w/${ws}/conexoes`);
  const accounts = await db.select().from(schema.adAccounts).where(and(eq(schema.adAccounts.workspaceId, ctx.workspaceId), eq(schema.adAccounts.connectionId, conn.id)));
  const currencies = new Set(accounts.map((a) => a.currency));
  return (
    <main className="mx-auto max-w-[760px] px-4 py-10 sm:px-8">
      <p className="text-[13px] text-ink-3">Passo 2 de 3</p>
      <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.025em] text-ink">Quais contas o Norte deve acompanhar?</h1>
      <p className="mt-2 max-w-[60ch] text-[14px] text-ink-2">
        A Meta liberou {accounts.length} {accounts.length === 1 ? "conta" : "contas"} para a autorização de {conn.externalUserName ?? "sua conta"}. As selecionadas passam a ser sincronizadas a cada {ctx.settings.syncIntervalMinutes ?? 15} minutos. Você pode mudar isso depois.
      </p>
      {currencies.size > 1 ? <p className="mt-3 rounded-[10px] bg-info-soft px-3 py-2 text-[13px] text-ink">Há contas em moedas diferentes ({[...currencies].join(", ")}). Cada conta é analisada na própria moeda; não fazemos conversão cambial.</p> : null}
      {accounts.length === 0 ? (
        <div className="mt-8 rounded-[14px] border border-line bg-surface p-6 text-[14px] text-ink-2">
          Nenhuma conta de anúncios foi compartilhada nesta autorização. Refaça a conexão e, na tela da Meta, marque as contas desejadas.
          <div className="mt-4"><Link href={`/w/${ws}/conexoes`} className={buttonClasses("secondary", "md")}>Voltar</Link></div>
        </div>
      ) : (
        <form action={saveAccountSelectionAction.bind(null, ws, conn.id)} className="mt-8">
          <fieldset className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-card">
            <legend className="sr-only">Contas de anúncios</legend>
            {accounts.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-start gap-3 border-b border-line px-5 py-4 last:border-0 hover:bg-surface-2">
                <input type="checkbox" name="accounts" value={a.id} defaultChecked={a.isSelected || accounts.length === 1} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-[14.5px] font-medium text-ink">
                    {a.name}
                    {a.accountStatus && a.accountStatus !== 1 ? <Badge tone="warn">{META_ACCOUNT_STATUS[a.accountStatus] ?? `Status ${a.accountStatus}`}</Badge> : null}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] text-ink-3">
                    {a.externalId} · {a.currency} · {timezoneLabel(a.timezoneName)}{a.businessName ? ` · ${a.businessName}` : ""}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button className={buttonClasses("primary", "lg")}>Salvar e sincronizar</button>
            <Link href={`/w/${ws}/conexoes`} className={buttonClasses("ghost", "lg")}>Cancelar</Link>
          </div>
          <p className="mt-4 text-[12.5px] text-ink-3">Passo 3: a importação do histórico começa em segundo plano e o progresso aparece na visão geral.</p>
        </form>
      )}
    </main>
  );
}
