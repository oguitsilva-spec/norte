import { Logo } from "@/components/brand/logo";
export const metadata = { title: "Exclusão de dados" };
export default async function DataDeletion({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[560px] flex-col justify-center gap-4 px-5">
      <Logo />
      <h1 className="text-[24px] font-semibold text-ink">Exclusão de dados da Meta</h1>
      <p className="text-[14.5px] leading-relaxed text-ink-2">Recebemos a solicitação enviada pela Meta. As autorizações foram revogadas e o histórico de anúncios importado para as contas vinculadas foi apagado.</p>
      {sp.codigo ? <p className="text-[14px] text-ink">Código de confirmação: <code className="rounded bg-surface-2 px-1.5 py-0.5">{sp.codigo}</code></p> : null}
    </main>
  );
}
