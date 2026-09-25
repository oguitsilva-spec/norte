/**
 * Comando de início único para o Railway (web e worker usam o mesmo railway.json).
 * - Serviço "worker" (RAILWAY_SERVICE_NAME contém "worker" ou SERVICE_ROLE=worker):
 *   roda o processo de sincronização e responde /api/health para a checagem da plataforma.
 * - Qualquer outro serviço (web): aplica as migrações e sobe o site.
 */
import { spawn } from "node:child_process";
import http from "node:http";

const role = (process.env.SERVICE_ROLE || process.env.RAILWAY_SERVICE_NAME || "web").toLowerCase();
const isWorker = role.includes("worker");
let child = null;

function start(cmd) {
  child = spawn(cmd, { shell: true, stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 1));
}
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => (child ? child.kill(sig) : process.exit(0)));

console.log(`[norte] iniciando como ${isWorker ? "worker" : "web"}`);
if (isWorker) {
  http
    .createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true,"role":"worker"}');
    })
    .listen(Number(process.env.PORT || 8080));
  start("npm run worker");
} else {
  const migrate = spawn("npm run db:migrate", { shell: true, stdio: "inherit" });
  migrate.on("exit", (code) => {
    if (code !== 0) {
      console.error("[norte] migrações falharam; o site não será iniciado.");
      process.exit(code ?? 1);
    }
    start("npm start");
  });
}
