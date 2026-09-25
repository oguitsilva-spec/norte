import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/tenancy/access";
import { getActiveWorkspaceId } from "@/server/tenancy/workspaces";

export default async function AppIndex({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await getSessionUser();
  if (!user) redirect("/entrar");
  const ws = await getActiveWorkspaceId(user.id);
  if (!ws) redirect("/entrar");
  const sp = await searchParams;
  const ERR: Record<string, string> = { estado_invalido: "invalid_state", meta_nao_configurada: "nao_configurado" };
  if (sp.erro && ERR[sp.erro]) redirect(`/w/${ws}/conexoes?erro=${ERR[sp.erro]}`);
  const q = sp["bem-vindo"] ? "?bem-vindo=1" : "";
  redirect(`/w/${ws}/visao-geral${q}`);
}
