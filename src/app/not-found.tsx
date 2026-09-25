import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-[520px] flex-col justify-center gap-4 px-5">
      <Logo />
      <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">Página não encontrada</h1>
      <p className="text-[14.5px] text-ink-2">O endereço não existe ou você não tem acesso a este conteúdo.</p>
      <Link href="/app" className={buttonClasses("primary", "md") + " w-fit"}>
        Ir para o painel
      </Link>
    </main>
  );
}
