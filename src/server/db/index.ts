import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { __norteSql?: ReturnType<typeof postgres>; __norteDb?: DB };

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");
  const client = postgres(url, { max: Number(process.env.DB_POOL_SIZE ?? 10), onnotice: () => {} });
  return { client, db: drizzle(client, { schema, casing: "snake_case" }) };
}

export function getDb(): DB {
  if (!globalForDb.__norteDb) {
    const { client, db } = create();
    globalForDb.__norteSql = client;
    globalForDb.__norteDb = db;
  }
  return globalForDb.__norteDb;
}

export function getSql() {
  getDb();
  return globalForDb.__norteSql!;
}

export async function closeDb() {
  await globalForDb.__norteSql?.end({ timeout: 5 });
  globalForDb.__norteSql = undefined;
  globalForDb.__norteDb = undefined;
}

export { schema };
export type { DB };
