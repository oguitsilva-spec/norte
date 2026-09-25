import Link from "next/link";
import { ShieldCheck, ArrowsClockwise, Funnel, Trophy } from "@phosphor-icons/react/ssr";
import { Logo } from "@/components/brand/logo";
import { buttonClasses } from "@/components/ui/button";
import { getSessionUser } from "@/server/tenancy/access";

export default async function Home() {
  const user = await getSessionUser();
  return (
    <div className="min-h-[100dvh]">
      <header className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5">
        <Logo />
        <nav className="flex items-center gap-2">
          {user ? (
            <Link href="/app" className={buttonClasses("primary", "md")}>
              Abrir painel
            </Link>
          ) : (
            <>
              <Link href="/entrar" className={buttonClasses("ghost", "md")}>
                Entrar
              </Link>
              <Link href="/criar-conta" className={buttonClasses("primary", "md")}>
                Criar conta
              </Link>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-5 pb-16 pt-12 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
          <div>
            <h1 className="max-w-[16ch] text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-[52px]">Seus anúncios da Meta, em números que dá para confiar.</h1>
            <p className="mt-5 max-w-[48ch] text-[17px] leading-relaxed text-ink-2">Investimento, compras, receita atribuída e ROAS por campanha e anúncio, atualizados sozinhos e explicados com clareza.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/criar-conta" className={buttonClasses("primary", "lg")}>
                Criar conta
              </Link>
              <Link href="/entrar" className={buttonClasses("secondary", "lg")}>
                Já tenho conta
              </Link>
            </div>
          </div>
          <div className="rounded-[18px] border border-line bg-surface p-6 shadow-pop">
            <p className="text-[13px] font-medium text-ink-2">O que o painel responde logo na primeira tela</p>
            <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                ["Quanto investi?", "Investimento no período, na moeda da conta."],
                ["Quanto voltou?", "Compras e receita atribuída, sem contar eventos duplicados."],
                ["Qual o ROAS?", "Calculado a partir dos totais, nunca pela média das campanhas."],
                ["Onde trava?", "Funil agregado com taxas reais, sem forçar números."],
              ].map(([q, a]) => (
                <li key={q} className="rounded-[12px] bg-surface-2 p-4">
                  <p className="text-[15px] font-semibold text-ink">{q}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{a}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-t border-line bg-surface">
          <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-16 md:grid-cols-2">
            {[
              { icon: ShieldCheck, t: "Conexão oficial, só leitura", d: "Autorização pelo Facebook Login for Business com a permissão ads_read. Tokens criptografados e nenhuma senha do Facebook." },
              { icon: ArrowsClockwise, t: "Sincronização em segundo plano", d: "A cada 15 minutos, com reprocessamento dos últimos dias para capturar conversões atrasadas." },
              { icon: Funnel, t: "Funis por negócio", d: "Monte funis por campanha e evento. Etapas sem dados aparecem como indisponíveis, nunca inventadas." },
              { icon: Trophy, t: "Rankings com critério", d: "Um anúncio com R$ 5 e uma venda não vira campeão: há limiares mínimos de gasto e resultados." },
            ].map(({ icon: Icon, t, d }) => (
              <div key={t} className="flex gap-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent-text">
                  <Icon size={20} weight="bold" />
                </span>
                <div>
                  <h2 className="text-[16px] font-semibold text-ink">{t}</h2>
                  <p className="mt-1 max-w-[52ch] text-[14px] leading-relaxed text-ink-2">{d}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-5 py-8 text-[12.5px] text-ink-3">
        <span>Norte · analytics de anúncios</span>
        <span>Não afiliado à Meta Platforms. Facebook e Instagram são marcas de seus respectivos titulares.</span>
      </footer>
    </div>
  );
}
