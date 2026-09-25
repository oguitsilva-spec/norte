import "server-only";
import { headers } from "next/headers";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "@/server/auth/auth";
import { getDb, schema } from "@/server/db";

export type Role = "owner" | "admin" | "viewer";
const RANK: Record<Role, number> = { viewer: 0, admin: 1, owner: 2 };

export class AccessError extends Error {
  constructor(
    public status: 401 | 403 | 404,
    message: string,
  ) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export function roleAtLeast(role: Role, min: Role) {
  return RANK[role] >= RANK[min];
}

export async function getSessionUser() {
  const s = await auth.api.getSession({ headers: await headers() });
  return s?.user ?? null;
}

export async function requireUser() {
  const u = await getSessionUser();
  if (!u) throw new AccessError(401, "Sessão expirada. Entre novamente.");
  return u;
}

export type WorkspaceContext = {
  userId: string;
  userName: string;
  userEmail: string;
  workspaceId: string;
  workspaceName: string;
  isDemo: boolean;
  role: Role;
  settings: schema.WorkspaceSettings;
  selectedAdAccountId: string | null;
};

/**
 * Ponto único de autorização para qualquer operação dentro de um workspace.
 * Responde 404 (e não 403) para workspaces dos quais o usuário não participa,
 * para não revelar a existência de IDs de outros clientes.
 */
export async function loadWorkspaceContext(userId: string, workspaceId: string, min: Role = "viewer") {
  if (!isUuid(workspaceId)) throw new AccessError(404, "Workspace não encontrado.");
  const db = getDb();
  const [row] = await db
    .select({
      role: schema.memberships.role,
      selectedAdAccountId: schema.memberships.selectedAdAccountId,
      name: schema.workspaces.name,
      isDemo: schema.workspaces.isDemo,
      settings: schema.workspaces.settings,
    })
    .from(schema.memberships)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)))
    .limit(1);
  if (!row) throw new AccessError(404, "Workspace não encontrado.");
  if (!roleAtLeast(row.role, min)) throw new AccessError(403, "Seu papel neste workspace não permite esta ação.");
  return row;
}

export async function requireWorkspace(workspaceId: string, min: Role = "viewer"): Promise<WorkspaceContext> {
  const user = await requireUser();
  const row = await loadWorkspaceContext(user.id, workspaceId, min);
  return {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    workspaceId,
    workspaceName: row.name,
    isDemo: row.isDemo,
    role: row.role,
    settings: row.settings ?? {},
    selectedAdAccountId: row.selectedAdAccountId,
  };
}

/** Busca uma conta de anúncios SEMPRE restrita ao workspace do contexto. */
export async function getAdAccountInWorkspace(workspaceId: string, adAccountId: string) {
  if (!isUuid(adAccountId)) return null;
  const db = getDb();
  const [acc] = await db
    .select()
    .from(schema.adAccounts)
    .where(and(eq(schema.adAccounts.id, adAccountId), eq(schema.adAccounts.workspaceId, workspaceId)))
    .limit(1);
  return acc ?? null;
}

/**
 * Resolve a conta ativa: a pedida (se pertencer ao workspace), senão a
 * seleção persistente do usuário, senão a primeira conta conectada.
 */
export async function resolveActiveAdAccount(ctx: WorkspaceContext, requested?: string | null) {
  const db = getDb();
  if (requested) {
    const acc = await getAdAccountInWorkspace(ctx.workspaceId, requested);
    if (acc && acc.isSelected) {
      if (acc.id !== ctx.selectedAdAccountId) {
        await db
          .update(schema.memberships)
          .set({ selectedAdAccountId: acc.id })
          .where(and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.userId, ctx.userId)));
      }
      return acc;
    }
  }
  if (ctx.selectedAdAccountId) {
    const acc = await getAdAccountInWorkspace(ctx.workspaceId, ctx.selectedAdAccountId);
    if (acc && acc.isSelected) return acc;
  }
  const [first] = await db
    .select()
    .from(schema.adAccounts)
    .where(and(eq(schema.adAccounts.workspaceId, ctx.workspaceId), eq(schema.adAccounts.isSelected, true)))
    .orderBy(asc(schema.adAccounts.name))
    .limit(1);
  return first ?? null;
}

export async function listSelectedAdAccounts(workspaceId: string) {
  return getDb()
    .select()
    .from(schema.adAccounts)
    .where(and(eq(schema.adAccounts.workspaceId, workspaceId), eq(schema.adAccounts.isSelected, true)))
    .orderBy(asc(schema.adAccounts.name));
}
