import Link from "next/link";
import { Flask, WarningCircle, LockKey, Info } from "@phosphor-icons/react/ssr";
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
    <header className="flex flex-col gap-4 border-b border-line bg-page px-4 pb-5 pt-6 sm:px-8">
      {ctx.isDemo ? (
        <Banner tone="demo" icon={<Flask size={18} weight="fill" className="text-warn" />}>
          <strong className="font-semibold">Modo demonstração.</strong> Todos os números desta área são fictícios e não vêm da Meta. Nada aqui se mistura com dados reais.
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
          {description ? <p className="mt-1 max-w-[70ch] text-[14px] text-ink-2">{description}</p> : null}
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
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
            <span>
              Moeda <span className="font-medium text-ink-2">{account.currency}</span>
            </span>
            <span aria-hidden>·</span>
            <span>
              Fuso <span className="font-medium text-ink-2">{timezoneLabel(account.timezone)}</span>
            </span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              Atribuição <span className="font-medium text-ink-2">configuração de cada conjunto (padrão Meta)</span>
              <Link href={`/w/${ws}/metricas#atribuicao`} aria-label="Sobre atribuição" className="text-ink-3 hover:text-ink">
                <Info size={14} />
              </Link>
            </span>
            {filters.includesToday ? (
              <>
                <span aria-hidden>·</span>
                <span className="font-medium text-warn">Hoje ainda está em andamento: números parciais</span>
              </>
            ) : null}
          </p>
        </div>
      ) : null}
    </header>
  );
}
