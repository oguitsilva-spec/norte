/**
 * Aplica as migrações SQL de ./drizzle usando apenas dependências de produção
 * (drizzle-orm + postgres). Idempotente: migrações já aplicadas são puladas.
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definida.");
  process.exit(1);
}
const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  console.log("Migrações aplicadas.");
} catch (e) {
  console.error("Falha ao aplicar migrações:", (e as Error).message);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
