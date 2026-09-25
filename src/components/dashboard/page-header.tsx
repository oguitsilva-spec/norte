import Link from "next/link";
import { Flask, WarningCircle, LockKey, Clock } from "@phosphor-icons/react/ssr";
import { Hint } from "@/components/ui/hint";
import { FilterBar } from "./filter-bar";
import { SyncStatus } from "./sync-status";
import type { PageData } from "@/server/page-context";
import type { ObjectiveGroup } from "@/lib/metrics/actions";
import { timezoneLabel, fmtDate } from "@/lib/format";

export function Banner({ tone, icon, children, action }: { tone: "warn" | "critical" | "info" | "demo"; icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  const cls = {
    warn: "border-warn/25 bg-warn-soft text-ink",
    critical: "border-critical/25 bg-critical-soft text-ink",
    info: "border-line bg-info-soft text-ink",
    demo: "border-warn/25 bg-warn-soft text-ink",
  }[tone];
  return (
    <div role={tone === "critical" ? "alert" : "status"} className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border px-4 py-3 text-[13.5px] leading-relaxed ${cls}`}>
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function PageHeader({
  data,
  title,
  description,
  campaigns,
  showFilters = true,
}: {
  data: PageData;
  title: string;
  description?: string;
  campaigns?: Array<{ id: string; name: string; group: ObjectiveGroup }>;
  showFilters?: boolean;
}) {
  const { ctx, account, freshness, filters } = data;
  const ws = ctx.workspaceId;
  return (
    <header className="flex flex-col gap-4 border-b border-line bg-page px-4 pb-5 pt-5 sm:px-8">
      {ctx.isDemo ? (
        <Banner tone="demo" icon={<Flask size={16} weight="fill" className="text-warn" />}>
          <strong className="font-semibold">Modo demonstração:</strong> números fictícios, que não vêm da Meta.
        </Banner>
      ) : null}
      {freshness?.stale ? (
        <Banner
          tone={freshness.connectionStatus === "active" ? "warn" : "critical"}
          icon={<WarningCircle size={18} weight="fill" className={freshness.connectionStatus === "active" ? "text-warn" : "text-critical"} />}
          action={
            <Link href={`/w/${ws}/conexoes`} className="text-[13px] font-semibold text-accent-text hover:underline">
              {freshness.connectionStatus === "active" ? "Ver sincronização" : "Reconectar"}
            </Link>
          }
        >
          <strong className="font-semibold">Dados possivelmente desatualizados.</strong> {freshness.staleReason}
          {freshness.dataThrough ? ` Os números vão até ${fmtDate(freshness.dataThrough)}.` : ""}
        </Banner>
      ) : null}
      {freshness && freshness.syncStatus === "permission_denied" && !freshness.stale ? (
        <Banner tone="critical" icon={<LockKey size={18} weight="fill" className="text-critical" />}>
          {freshness.lastErrorMessage}
        </Banner>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em] text-ink sm:text-[26px]">{title}</h1>
          {description ? <p className="mt-1 max-w-[70ch] text-[13.5px] text-ink-3">{description}</p> : null}
        </div>
        {account && freshness ? <SyncStatus ws={ws} accountId={account.id} timezone={account.timezone} freshness={freshness} isDemo={ctx.isDemo} /> : null}
      </div>

      {showFilters && account ? (
        <div className="flex flex-col gap-2.5">
          <FilterBar
            ws={ws}
            accounts={data.accounts}
            accountId={account.id}
            preset={filters.preset}
            from={filters.from}
            to={filters.to}
            today={freshness?.todayInAccountTz ?? filters.to}
            campaigns={campaigns}
            campaignId={filters.campaign}
            objective={filters.objective}
          />
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-ink-3">
            <span className="inline-flex items-center gap-1">
              {account.currency} · {timezoneLabel(account.timezone)}
              <Hint label="Moeda, fuso e atribuição">
                <p>
                  Valores em <strong className="font-medium text-ink">{account.currency}</strong>, datas no fuso da conta ({timezoneLabel(account.timezone)}).
                </p>
                <p className="mt-1.5">Compras e receita usam a atribuição configurada em cada conjunto (padrão da Meta) e podem diferir das vendas do seu checkout.</p>
                <Link href={`/w/${ws}/metricas#atribuicao`} className="mt-1.5 inline-block font-medium text-accent-text hover:underline">
                  Como as métricas são calculadas
                </Link>
              </Hint>
            </span>
            {filters.includesToday ? (
              <span className="inline-flex items-center gap-1 font-medium text-warn">
                <Clock size={13} weight="bold" /> hoje ainda em andamento
              </span>
            ) : null}
          </p>
        </div>
      ) : null}
    </header>
  );
}
