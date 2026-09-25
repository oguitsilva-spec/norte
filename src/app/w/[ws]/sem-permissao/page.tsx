import Link from "next/link";
import { LockKey } from "@phosphor-icons/react/ssr";
import { buttonClasses } from "@/components/ui/button";

export default async function NoPermission({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return (
    <main className="mx-auto flex max-w-[560px] flex-col items-start gap-4 px-4 py-20 sm:px-8">
      <span className="grid h-12 w-12 place-items-center rounded-[14px] border border-line bg-surface text-critical shadow-card"><LockKey size={24} /></span>
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">Seu papel não permite esta ação</h1>
      <p className="text-[14.5px] leading-relaxed text-ink-2">Leitores podem visualizar os painéis, mas não conectar contas nem alterar configurações. Peça a um administrador do workspace.</p>
      <Link href={`/w/${ws}/visao-geral`} className={buttonClasses("secondary", "md")}>Voltar à visão geral</Link>
    </main>
  );
}
