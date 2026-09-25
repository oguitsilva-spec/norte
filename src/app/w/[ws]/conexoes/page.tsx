import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Plugs, ShieldCheck, WarningCircle, CheckCircle, Clock, LockKey, XCircle, ArrowsClockwise, Flask } from "@phosphor-icons/react/ssr";
import { loadPage } from "@/server/page-context";
import { getDb, schema } from "@/server/db";
import { metaAppConfig } from "@/server/providers/meta/connection";
import { connectMetaAction, disconnectMetaAction, checkHealthAction } from "@/server/actions/meta";
import { PROVIDERS } from "@/server/providers/catalog";
import { PageHeader, Banner } from "@/components/dashboard/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { fmtDateTime, fmtRelative, fmtDate, timezoneLabel } from "@/lib/format";
import { ConfirmSubmit } from "@/components/dashboard/confirm-submit";

export const metadata = { title: "Conexões" };

function expiresSoon(d: Date | null) {
  return Boolean(d && d.getTime() - Date.now() < 10 * 86400_000);
}
type SP = Record<string, string | string[] | undefined>;

const CONN_STATUS: Record<string, { label: string; tone: "good" | "warn" | "critical" | "neutral"; icon: typeof CheckCircle }> = {
  active: { label: "Ativa", tone: "good", icon: CheckCircle },
  expired: { label: "Expirada", tone: "critical", icon: Clock },
  revoked: { label: "Revogada", tone: "critical", icon: XCircle },
  permission_denied: { label: "Permissão negada", tone: "critical", icon: LockKey },
  error: { label: "Com erro", tone: "warn", icon: WarningCircle },
  disconnected: { label: "Desconectada", tone: "neutral", icon: XCircle },
};
const ACC_STATUS: Record<string, { label: string; tone: "good" | "warn" | "critical" | "neutral" | "accent" }> = {
  pending: { label: "Aguardando", tone: "neutral" },
  initial_sync: { label: "Importando histórico", tone: "accent" },
  ok: { label: "Em dia", tone: "good" },
  error: { label: "Erro", tone: "critical" },
  permission_denied: { label: "Sem permissão", tone: "critical" },
  paused: { label: "Pausada", tone: "neutral" },
};
const RUN_KIND: Record<string, string> = { initial: "Inicial", incremental: "Incremental", manual: "Manual" };
const RUN_STATUS: Record<string, { label: string; tone: "good" | "warn" | "critical" | "neutral" | "accent" }> = {
  queued: { label: "Na fila", tone: "neutral" },
  running: { label: "Rodando", tone: "accent" },
  succeeded: { label: "Concluída", tone: "good" },
  failed: { label: "Falhou", tone: "critical" },
  partial: { label: "Parcial", tone: "warn" },
};
const ERRORS: Record<string, string> = {
  cancelled: "A autorização foi cancelada na tela da Meta. Nenhum acesso foi concedido.",
  missing_permission: "A permissão ads_read não foi concedida. Sem ela não é possível ler o desempenho das campanhas.",
  exchange_failed: "Não foi possível concluir a autorização com a Meta. Tente novamente em instantes.",
  invalid_state: "A solicitação de conexão expirou ou não corresponde a esta sessão. Inicie a conexão novamente.",
  nao_configurado: "A integração com a Meta não está configurada neste ambiente (faltam App ID, App Secret e Configuration ID).",
  demo: "Workspaces de demonstração não se conectam à Meta. Use o seu workspace principal.",
};

export default async function ConnectionsPage({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<SP> }) {
  const { ws } = await params;
  const sp = await searchParams;
  const data = await loadPage(ws, sp);
  const { ctx } = data;
  const db = getDb();
  const configured = Boolean(metaAppConfig());
  const isAdmin = ctx.role !== "viewer";
  const conns = await db.select().from(schema.providerConnections).where(eq(schema.providerConnections.workspaceId, ctx.workspaceId)).orderBy(desc(schema.providerConnections.createdAt));
  const accounts = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.workspaceId, ctx.workspaceId));
  const jobs = accounts.length ? await db.select().from(schema.syncJobs).where(inArray(schema.syncJobs.adAccountId, accounts.map((a) => a.id))) : [];
  const runs = await db
    .select({ r: schema.syncRuns, name: schema.adAccounts.name, tz: schema.adAccounts.timezoneName })
    .from(schema.syncRuns)
    .innerJoin(schema.adAccounts, eq(schema.adAccounts.id, schema.syncRuns.adAccountId))
    .where(and(eq(schema.syncRuns.workspaceId, ctx.workspaceId)))
    .orderBy(desc(schema.syncRuns.createdAt))
    .limit(25);
  const errBase = typeof sp.erro === "string" ? ERRORS[sp.erro] : null;
  const errDetail = typeof sp.detalhe === "string" ? sp.detalhe.replace(/[^a-z0-9_:,]/gi, "").slice(0, 80) : "";
  const err = errBase ? (errDetail ? `${errBase} (código: ${errDetail})` : errBase) : null;
  const selected = accounts.filter((a) => a.isSelected);
  const tzUser = selected[0]?.timezoneName ?? "America/Sao_Paulo";

  return (
    <>
      <PageHeader data={data} title="Conexões" description="Autorizações com a Meta, contas sincronizadas e histórico de sincronização." showFilters={false} />
      <main className="flex flex-col gap-5 px-4 py-6 sm:px-8">
        {err ? <Banner tone="critical" icon={<WarningCircle size={18} weight="fill" className="text-critical" />}>{err}</Banner> : null}
        {sp.sincronizando ? <Banner tone="info" icon={<ArrowsClockwise size={18} className="text-accent-text" />}>Primeira sincronização iniciada. Ela roda em segundo plano; acompanhe o progresso na visão geral.</Banner> : null}

        <Card>
          <CardHeader
            title={<span className="inline-flex items-center gap-2"><Plugs size={18} className="text-accent-text" /> Meta Ads</span>}
            description="Facebook Login for Business · somente leitura (ads_read). Separado do seu login no Norte."
            action={
              ctx.isDemo ? (
                <Badge tone="warn"><Flask size={13} /> Demonstração: sem conexão real</Badge>
              ) : isAdmin && configured ? (
                <form action={connectMetaAction.bind(null, ws)}>
                  <button className={buttonClasses("primary", "md")}>
                    <Plugs size={16} weight="bold" /> {conns.some((c) => c.status !== "disconnected") ? "Conectar outra autorização" : "Conectar Meta Ads"}
                  </button>
                </form>
              ) : !configured ? (
                <Badge tone="warn">Integração não configurada neste ambiente</Badge>
              ) : null
            }
          />
          <div className="px-5 pb-5 pt-4">
            {ctx.isDemo ? (
              <p className="text-[13.5px] text-ink-2">Os dados deste workspace foram gerados para demonstração e nunca são sincronizados com a Meta. O histórico abaixo é ilustrativo.</p>
            ) : conns.length === 0 ? (
              <p className="text-[13.5px] text-ink-2">Nenhuma autorização ainda. Ao conectar, você será levado à tela da Meta, escolherá as contas e voltará para cá.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {conns.map((c) => {
                  const st = CONN_STATUS[c.status];
                  const Icon = st.icon;
                  const connAccounts = accounts.filter((a) => a.connectionId === c.id);
                  const soon = expiresSoon(c.tokenExpiresAt);
                  return (
                    <li key={c.id} className="rounded-[12px] border border-line p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-ink">
                            {c.externalUserName ?? "Autorização Meta"}
                            <Badge tone={st.tone}><Icon size={13} weight="fill" /> {st.label}</Badge>
                          </p>
                          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
                            <div><dt className="inline text-ink-3">Tipo de token: </dt><dd className="inline text-ink-2">{c.tokenType === "system_user" ? "Usuário do sistema (Business Integration)" : "Usuário (longa duração)"}</dd></div>
                            <div><dt className="inline text-ink-3">Expira: </dt><dd className={soon ? "inline font-medium text-warn" : "inline text-ink-2"}>{c.tokenExpiresAt ? fmtDate(c.tokenExpiresAt.toISOString().slice(0, 10)) : "sem data informada pela Meta"}</dd></div>
                            <div><dt className="inline text-ink-3">Permissões: </dt><dd className="inline text-ink-2">{c.grantedScopes.join(", ") || "n/d"}</dd></div>
                            <div><dt className="inline text-ink-3">Última verificação: </dt><dd className="inline text-ink-2">{c.lastCheckedAt ? fmtRelative(c.lastCheckedAt) : "nunca"}</dd></div>
                          </dl>
                          {c.lastErrorMessage && c.status !== "active" ? <p className="mt-2 text-[12.5px] text-critical">{c.lastErrorMessage}</p> : null}
                          {soon && c.status === "active" ? <p className="mt-2 text-[12.5px] text-warn">A Meta não oferece refresh token para este tipo de autorização. Reconecte antes da expiração para não interromper a sincronização.</p> : null}
                        </div>
                        {isAdmin && c.status !== "disconnected" ? (
                          <div className="flex flex-wrap gap-2">
                            {c.status === "active" ? <Link href={`/w/${ws}/conexoes/meta/contas?conexao=${c.id}`} className={buttonClasses("secondary", "sm")}>Escolher contas</Link> : null}
                            {configured ? (
                              <form action={checkHealthAction.bind(null, ws, c.id)}>
                                <button className={buttonClasses("secondary", "sm")}><ShieldCheck size={15} /> Verificar agora</button>
                              </form>
                            ) : null}
                            {c.status !== "active" && configured ? (
                              <form action={connectMetaAction.bind(null, ws)}>
                                <button className={buttonClasses("primary", "sm")}>Reconectar</button>
                              </form>
                            ) : null}
                            <ConfirmSubmit action={disconnectMetaAction.bind(null, ws, c.id)} label="Desconectar" message="Desconectar esta autorização? A sincronização para, o token é apagado e os dados já importados continuam visíveis." />
                          </div>
                        ) : null}
                      </div>
                      {connAccounts.length ? <p className="mt-3 text-[12.5px] text-ink-3">{connAccounts.filter((a) => a.isSelected).length} de {connAccounts.length} contas acessíveis estão selecionadas.</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Contas sincronizadas" description="Moeda, fuso e atribuição são os da própria conta de anúncios. Contas de moedas diferentes nunca são somadas." />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="bg-surface-2 text-left text-[12px] text-ink-3">
                  <th className="px-5 py-2.5 font-medium">Conta</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Moeda · fuso</th>
                  <th className="px-3 py-2.5 font-medium">Última sincronização</th>
                  <th className="px-3 py-2.5 font-medium">Cobertura</th>
                  <th className="px-5 py-2.5 font-medium">Próxima</th>
                </tr>
              </thead>
              <tbody>
                {selected.map((a) => {
                  const st = ACC_STATUS[a.syncStatus];
                  const job = jobs.find((j) => j.adAccountId === a.id);
                  return (
                    <tr key={a.id} className="border-t border-line align-top">
                      <td className="px-5 py-3">
                        <p className="font-medium text-ink">{a.name}</p>
                        <p className="text-[12px] text-ink-3">{a.externalId}{a.businessName ? ` · ${a.businessName}` : ""}</p>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={st.tone}>{st.label}{a.syncProgress !== null && a.syncStatus === "initial_sync" ? ` ${Math.round(a.syncProgress * 100)}%` : ""}</Badge>
                        {a.lastErrorMessage && a.syncStatus !== "ok" ? <p className="mt-1 max-w-[260px] text-[12px] text-critical">{a.lastErrorMessage}</p> : null}
                      </td>
                      <td className="px-3 py-3 text-ink-2">{a.currency} · {timezoneLabel(a.timezoneName)}</td>
                      <td className="px-3 py-3 text-ink-2">{a.lastSuccessfulSyncAt ? <span title={fmtDateTime(a.lastSuccessfulSyncAt, a.timezoneName)}>{fmtRelative(a.lastSuccessfulSyncAt)}</span> : "ainda não"}</td>
                      <td className="px-3 py-3 text-ink-2">{a.dataFrom && a.dataThrough ? `${fmtDate(a.dataFrom)} a ${fmtDate(a.dataThrough)}` : "n/d"}</td>
                      <td className="px-5 py-3 text-ink-2">{job?.enabled ? `a cada ${job.intervalMinutes} min` : ctx.isDemo ? "não sincroniza (demo)" : "pausada"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {selected.length === 0 ? <p className="px-5 py-6 text-[13.5px] text-ink-3">Nenhuma conta selecionada.</p> : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="Histórico de sincronização" description={`Últimas 25 execuções. Horários no fuso ${timezoneLabel(tzUser)}.`} />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="bg-surface-2 text-left text-[12px] text-ink-3">
                  <th className="px-5 py-2.5 font-medium">Início</th>
                  <th className="px-3 py-2.5 font-medium">Conta</th>
                  <th className="px-3 py-2.5 font-medium">Tipo</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Janela</th>
                  <th className="px-3 py-2.5 text-right font-medium">Linhas</th>
                  <th className="px-5 py-2.5 text-right font-medium">Chamadas à API</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(({ r, name, tz }) => {
                  const st = RUN_STATUS[r.status];
                  return (
                    <tr key={r.id} className="border-t border-line align-top">
                      <td className="px-5 py-2.5 text-ink-2 tnum">{fmtDateTime(r.startedAt ?? r.createdAt, tz)}</td>
                      <td className="px-3 py-2.5 text-ink">{name}</td>
                      <td className="px-3 py-2.5 text-ink-2">{RUN_KIND[r.kind]}{r.attempt > 1 ? ` · tentativa ${r.attempt}` : ""}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {r.errorMessage ? <p className="mt-1 max-w-[320px] text-[12px] text-ink-3">{r.errorMessage}</p> : null}
                      </td>
                      <td className="px-3 py-2.5 text-ink-2">{r.dateFrom && r.dateTo ? `${fmtDate(r.dateFrom)} a ${fmtDate(r.dateTo)}` : "n/d"}</td>
                      <td className="px-3 py-2.5 text-right text-ink-2 tnum">{r.rowsUpserted}</td>
                      <td className="px-5 py-2.5 text-right text-ink-2 tnum">{r.apiCalls}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {runs.length === 0 ? <p className="px-5 py-6 text-[13.5px] text-ink-3">Nenhuma sincronização registrada.</p> : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="Outras fontes" description="Apenas a Meta está disponível hoje. As demais estão planejadas; nenhuma delas finge estar conectada." />
          <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-b-[14px] border-t border-line bg-line sm:grid-cols-2 xl:grid-cols-4 mt-4">
            {PROVIDERS.filter((p) => p.id !== "meta").map((p) => (
              <li key={p.id} className="bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[14px] font-semibold text-ink">{p.name}</p>
                  <Badge>Planejado</Badge>
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{p.description}</p>
              </li>
            ))}
          </ul>
        </Card>
      </main>
    </>
  );
}
