/**
 * Cria um usuário de demonstração com workspace demo populado.
 * Uso: npm run db:seed-demo -- email@exemplo.com "Senha-forte-123"
 */
import "dotenv/config";
import { auth } from "@/server/auth/auth";
import { createDemoWorkspace } from "@/server/demo/seed";
import { closeDb } from "@/server/db";
import { setActiveWorkspace } from "@/server/tenancy/workspaces";

const [email = "demo@norte.local", password = "demonstracao-norte"] = process.argv.slice(2);
const res = await auth.api.signUpEmail({ body: { name: "Demonstração", email, password } });
const ws = await createDemoWorkspace(res.user.id);
await setActiveWorkspace(res.user.id, ws.id);
console.log(`Usuário ${email} criado. Workspace demo: /w/${ws.id}/visao-geral`);
await closeDb();
