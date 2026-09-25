"use client";
import { WarningOctagon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-[600px] flex-col items-start gap-4 px-4 py-20 sm:px-8">
      <span className="grid h-12 w-12 place-items-center rounded-[14px] border border-line bg-surface text-critical shadow-card">
        <WarningOctagon size={24} />
      </span>
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">Não foi possível carregar esta tela</h1>
      <p className="text-[14.5px] leading-relaxed text-ink-2">Houve um erro ao ler os dados. Nenhum número foi substituído por valores de exemplo. Tente novamente; se persistir, informe o código abaixo ao suporte.</p>
      {error.digest ? <code className="rounded bg-surface-2 px-2 py-1 text-[12.5px] text-ink-2">{error.digest}</code> : null}
      <Button onClick={reset}>Tentar novamente</Button>
    </main>
  );
}
