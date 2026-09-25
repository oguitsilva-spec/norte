import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { getSessionUser } from "@/server/tenancy/access";
import { redirect } from "next/navigation";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (user) redirect("/app");
  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <Link href="/" className="w-fit" aria-label="Norte, página inicial">
          <Logo />
        </Link>
        <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">{children}</main>
        <p className="text-[12.5px] text-ink-3">Seu acesso ao Norte é separado da sua conta do Facebook. Nunca pedimos sua senha da Meta.</p>
      </div>
      <aside className="relative hidden overflow-hidden border-l border-line bg-surface-2 lg:flex lg:flex-col lg:justify-center lg:px-14">
        <div className="max-w-[520px]">
          <p className="text-[28px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink">
            Quanto você investiu, quanto voltou e onde o funil trava.
          </p>
          <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-ink-2">
            Conecte suas contas Meta com autorização oficial e acompanhe ROAS, compras e receita atribuída, atualizados automaticamente.
          </p>
          <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-line bg-line">
            {[
              ["Somente leitura", "Pedimos apenas ads_read. Nada é alterado nas suas campanhas."],
              ["Atualização contínua", "Sincronização em segundo plano a cada 15 minutos, com reconciliação de conversões atrasadas."],
              ["Números auditáveis", "Cada métrica mostra fórmula, fonte e janela de atribuição."],
              ["Dados isolados", "Cada workspace só enxerga as próprias contas."],
            ].map(([t, d]) => (
              <div key={t} className="bg-surface p-5">
                <dt className="text-[14px] font-semibold text-ink">{t}</dt>
                <dd className="mt-1.5 text-[13px] leading-relaxed text-ink-3">{d}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  );
}
