import Link from "next/link";
import { Plugs, Flask, LockKey, ArrowClockwise, ChartLineUp, Wrench, CalendarX } from "@phosphor-icons/react/ssr";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { metaAppConfig } from "@/server/providers/meta/connection";
import { connectMetaAction } from "@/server/actions/meta";
import { createDemoAction } from "@/server/actions/workspace";
import { buttonClasses } from "@/components/ui/button";
import type { WorkspaceContext } from "@/server/tenancy/access";
import { FirstSyncProgress } from "./first-sync";

function Shell({ icon, title, children, actions }: { icon: React.ReactNode; title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[640px] flex-col items-start gap-4 px-4 py-14 sm:px-8 sm:py-20">
      <span className="grid h-12 w-12 place-items-center rounded-[14px] border border-line bg-surface text-accent-text shadow-card">{icon}</span>
      <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
      <div className="text-[14.5px] leading-relaxed text-ink-2">{children}</div>
      {actions ? <div className="mt-2 flex flex-wrap gap-2.5">{actions}</div> : null}
    </div>
  );
}

/** Estados de "sem conta disponível": não configurado, desconectado, expirado, sem permissão, sem seleção. */
export async function NoAccountState({ ctx }: { ctx: WorkspaceContext }) {
  const ws = ctx.workspaceId;
  const isAdmin = ctx.role !== "viewer";
  const connections = await getDb().select().from(schema.providerConnections).where(eq(schema.providerConnections.workspaceId, ws));
  const discovered = await getDb().select({ id: schema.adAccounts.id }).from(schema.adAccounts).where(and(eq(schema.adAccounts.workspaceId, ws)));
  const configured = Boolean(metaAppConfig());
  const active = connections.find((c) => c.status === "active");
  const broken = connections.find((c) => c.status === "expired" || c.status === "revoked");
  const denied = connections.find((c) => c.status === "permission_denied");
  const connectForm = (label = "Conectar Meta Ads") => (
    <form action={connectMetaAction.bind(null, ws)}>
      <button className={buttonClasses("primary", "lg")}>
        <Plugs size={18} weight="bold" /> {label}
      </button>
    </form>
  );
  const demoForm = (
    <form action={createDemoAction}>
      <button className={buttonClasses("secondary", "lg")}>
        <Flask size={18} /> Explorar o modo demonstração
      </button>
    </form>
  );

  if (active && discovered.length)
    return (
      <Shell icon={<ChartLineUp size={24} />} title="Escolha as contas de anúncios" actions={isAdmin ? <Link className={buttonClasses("primary", "lg")} href={`/w/${ws}/conexoes/meta/contas?conexao=${active.id}`}>Selecionar contas</Link> : null}>
        A Meta está conectada e encontramos {discovered.length} {discovered.length === 1 ? "conta" : "contas"} acessíveis. Selecione quais devem ser sincronizadas.
        {!isAdmin ? " Peça a um administrador do workspace para fazer a seleção." : ""}
      </Shell>
    );
  if (broken)
    return (
      <Shell icon={<ArrowClockwise size={24} />} title="Reconecte a Meta" actions={isAdmin && configured ? connectForm("Reconectar Meta Ads") : null}>
        {broken.lastErrorMessage ?? "A autorização da Meta expirou ou foi revogada."} Os dados já importados continuam disponíveis, mas não serão atualizados até a reconexão.
      </Shell>
    );
  if (denied)
    return (
      <Shell icon={<LockKey size={24} />} title="Permissão de leitura não concedida" actions={isAdmin && configured ? connectForm("Autorizar novamente") : null}>
        Para ler o desempenho das campanhas, a Meta precisa conceder a permissão <code className="rounded bg-surface-2 px-1 text-[13px]">ads_read</code>. Na tela da Meta, mantenha as contas de anúncios e essa permissão marcadas.
      </Shell>
    );
  if (!configured)
    return (
      <Shell icon={<Wrench size={24} />} title="Integração com a Meta ainda não configurada" actions={demoForm}>
        <p>Este ambiente não tem as credenciais do app Meta (App ID, App Secret e Configuration ID do Facebook Login for Business). Sem elas, nenhuma conexão real é feita e nenhum número é inventado.</p>
        <p className="mt-3">Enquanto isso, você pode explorar o produto completo em um workspace de demonstração separado, com dados fictícios claramente identificados.</p>
        {isAdmin ? <p className="mt-3 text-[13px] text-ink-3">Administradores: o passo a passo está em docs/META_SETUP.md no repositório.</p> : null}
      </Shell>
    );
  return (
    <Shell icon={<Plugs size={24} />} title="Conecte suas contas de anúncios da Meta" actions={isAdmin ? <>{connectForm()}{demoForm}</> : demoForm}>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5">
        <li>Você será levado à tela oficial da Meta para autorizar o acesso.</li>
        <li>Pedimos só leitura (ads_read). Nunca pedimos sua senha do Facebook.</li>
        <li>De volta aqui, escolha as contas e acompanhe a primeira sincronização.</li>
      </ol>
      {!isAdmin ? <p className="mt-3">Apenas administradores podem conectar contas. Peça a um administrador deste workspace.</p> : null}
    </Shell>
  );
}

export function FirstSyncState({ ws, accountId, name }: { ws: string; accountId: string; name: string }) {
  return (
    <Shell icon={<ArrowClockwise size={24} />} title="Importando o histórico da conta">
      <p>
        Estamos trazendo os últimos {process.env.SYNC_INITIAL_HISTORY_DAYS ?? 90} dias de <strong className="font-semibold text-ink">{name}</strong>: estrutura das campanhas, métricas diárias por anúncio e posicionamentos. Isso roda em segundo plano; você pode sair desta página.
      </p>
      <FirstSyncProgress ws={ws} accountId={accountId} />
    </Shell>
  );
}

export function EmptyPeriodState({ ws, qsWithout }: { ws: string; qsWithout: string }) {
  return (
    <Shell icon={<CalendarX size={24} />} title="Nenhuma entrega neste período" actions={<Link href={`/w/${ws}/visao-geral${qsWithout}`} className={buttonClasses("secondary", "md")}>Ver últimos 30 dias</Link>}>
      Não há investimento nem resultados registrados para os filtros escolhidos. Isso é diferente de erro: a sincronização está em dia e simplesmente não houve veiculação.
    </Shell>
  );
}
