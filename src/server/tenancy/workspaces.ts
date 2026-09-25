import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";

export async function createWorkspace(ownerUserId: string, name: string, opts: { isDemo?: boolean } = {}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [ws] = await tx
      .insert(schema.workspaces)
      .values({ name, isDemo: opts.isDemo ?? false, settings: { rankingMinResults: 3 } })
      .returning();
    await tx.insert(schema.memberships).values({ workspaceId: ws.id, userId: ownerUserId, role: "owner" });
    await tx
      .insert(schema.userPreferences)
      .values({ userId: ownerUserId, activeWorkspaceId: ws.id })
      .onConflictDoNothing();
    return ws;
  });
}

export async function listUserWorkspaces(userId: string) {
  return getDb()
    .select({
      id: schema.workspaces.id,
      name: schema.workspaces.name,
      isDemo: schema.workspaces.isDemo,
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(eq(schema.memberships.userId, userId))
    .orderBy(asc(schema.workspaces.isDemo), asc(schema.workspaces.createdAt));
}

export async function getActiveWorkspaceId(userId: string): Promise<string | null> {
  const db = getDb();
  const [pref] = await db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, userId));
  if (pref?.activeWorkspaceId) {
    const [m] = await db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.workspaceId, pref.activeWorkspaceId)));
    if (m) return pref.activeWorkspaceId;
  }
  const list = await listUserWorkspaces(userId);
  return list[0]?.id ?? null;
}

export async function setActiveWorkspace(userId: string, workspaceId: string) {
  await getDb()
    .insert(schema.userPreferences)
    .values({ userId, activeWorkspaceId: workspaceId })
    .onConflictDoUpdate({ target: schema.userPreferences.userId, set: { activeWorkspaceId: workspaceId, updatedAt: new Date() } });
}
