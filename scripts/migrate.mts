/**
 * Aplica as migrações SQL de ./drizzle usando apenas dependências de produção
 * (drizzle-orm + postgres). Idempotente: migrações já aplicadas são puladas.
 * Nunca fica pendurado: desiste da conexão em 20 s e do processo inteiro em 2 min.
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
const guard = setTimeout(() => {
  console.error("Migrações não terminaram em 2 minutos (banco inacessível?). Abortando.");
  process.exit(1);
}, 120_000);
guard.unref();

const client = postgres(url, { max: 1, connect_timeout: 20, onnotice: () => {} });
try {
  console.log("Aplicando migrações…");
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  console.log("Migrações aplicadas.");
} catch (e) {
  console.error("Falha ao aplicar migrações:", (e as Error).message);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
  clearTimeout(guard);
}
