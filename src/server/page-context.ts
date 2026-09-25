import "server-only";
import { redirect, notFound } from "next/navigation";
import { AccessError, requireWorkspace, resolveActiveAdAccount, listSelectedAdAccounts, type Role } from "@/server/tenancy/access";
import { listUserWorkspaces } from "@/server/tenancy/workspaces";
import { parseFilters } from "@/lib/filters";
import { todayInTimezone } from "@/lib/metrics/core";
import { getFreshness, accountInfo } from "@/server/analytics/dashboard";

type SP = Record<string, string | string[] | undefined>;

export async function guard<T>(fn: () => Promise<T>, wsId?: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AccessError) {
      if (e.status === 401) redirect("/entrar");
      if (e.status === 403) redirect(wsId ? `/w/${wsId}/sem-permissao` : "/app");
      notFound();
    }
    throw e;
  }
}

/** Contexto comum às telas do painel: autorização, conta ativa, filtros e frescor. */
export async function loadPage(wsId: string, sp: SP, min: Role = "viewer") {
  const ctx = await guard(() => requireWorkspace(wsId, min), wsId);
  const [accounts, workspaces] = await Promise.all([listSelectedAdAccounts(ctx.workspaceId), listUserWorkspaces(ctx.userId)]);
  const requested = Array.isArray(sp.conta) ? sp.conta[0] : sp.conta;
  const acc = await resolveActiveAdAccount(ctx, requested ?? null);
  const today = todayInTimezone(acc?.timezoneName ?? "America/Sao_Paulo");
  const filters = parseFilters(sp, today);
  filters.account = acc?.id ?? null;
  const freshness = acc ? await getFreshness(ctx, acc) : null;
  return {
    ctx,
    acc,
    account: acc ? accountInfo(acc, ctx.isDemo) : null,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, externalId: a.externalId, syncStatus: a.syncStatus })),
    workspaces,
    filters,
    freshness,
  };
}
export type PageData = Awaited<ReturnType<typeof loadPage>>;
