import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { randomUUID } from "node:crypto";

let migrated = false;
export async function setupDb() {
  const db = getDb();
  if (!migrated) {
    await migrate(db, { migrationsFolder: "drizzle" });
    migrated = true;
  }
  await db.execute(sql`truncate table "user", workspaces, mail_outbox, oauth_states restart identity cascade`);
  await db.execute(sql`do $$ begin if exists (select 1 from information_schema.schemata where schema_name='pgboss') then execute 'truncate table pgboss.job cascade'; end if; exception when others then null; end $$;`);
  return db;
}

export async function createUser(name = "Ana") {
  const db = getDb();
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name, email: `${id}@teste.dev`, emailVerified: true });
  return id;
}

export async function createWorkspaceWith(userId: string, role: "owner" | "admin" | "viewer" = "owner", isDemo = false) {
  const db = getDb();
  const [ws] = await db.insert(schema.workspaces).values({ name: `WS ${userId.slice(0, 4)}`, isDemo }).returning();
  await db.insert(schema.memberships).values({ workspaceId: ws.id, userId, role });
  return ws.id;
}
