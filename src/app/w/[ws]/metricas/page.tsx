import { loadPage } from "@/server/page-context";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { METRICS, NON_ADDITIVE_NOTE } from "@/lib/metrics/definitions";
import { ACTION_PRIORITY } from "@/lib/metrics/actions";

export const metadata = { title: "Dicionário de métricas" };

const ACTION_LABEL: Record<string, string> = { purchase: "Compras", lead: "Leads", messaging: "Conversas", landing_page_view: "Visualizações da página", add_to_cart: "Adições ao carrinho", initiate_checkout: "Checkouts iniciados" };

export default async function MetricsPage({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ws } = await params;
  const data = await loadPage(ws, await searchParams);
  const map = data.acc?.actionTypeMap ?? {};
  return (
    <>
      <PageHeader data={data} title="Dicionário de métricas" description="Definição, fórmula, fonte e regra de agregação de cada número exibido." showFilters={false} />
      <main className="flex flex-col gap-5 px-4 py-6 sm:px-8">
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="bg-surface-2 text-left text-[12px] text-ink-3">
                  <th className="px-5 py-2.5 font-medium">Métrica</th>
                  <th className="px-3 py-2.5 font-medium">Fórmula</th>
                  <th className="px-3 py-2.5 font-medium">Fonte</th>
                  <th className="px-5 py-2.5 font-medium">Agregação</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(METRICS).map((m) => (
                  <tr key={m.key} className="border-t border-line align-top">
                    <td className="px-5 py-3 font-medium text-ink">{m.label}</td>
                    <td className="px-3 py-3 text-ink">{m.formula}</td>
                    <td className="px-3 py-3 text-ink-2">{m.source}</td>
                    <td className="px-5 py-3 text-ink-2">{m.aggregation}</td>
                  </tr>
                ))}
                <tr className="border-t border-line align-top">
                  <td className="px-5 py-3 font-medium text-ink">Alcance e frequência</td>
                  <td className="px-3 py-3 text-ink">Pessoas únicas · impressões ÷ alcance</td>
                  <td className="px-3 py-3 text-ink-2">Meta Insights · reach/frequency, consultados para o intervalo exato</td>
                  <td className="px-5 py-3 text-ink-2">{NON_ADDITIVE_NOTE}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card id="atribuicao">
            <CardHeader title="Atribuição e contexto de relatório" />
            <ul className="flex flex-col gap-2.5 px-5 pb-5 pt-3 text-[13.5px] leading-relaxed text-ink-2">
              <li><strong className="font-semibold text-ink">Janela:</strong> configuração de atribuição de cada conjunto de anúncios (a mesma usada pelo Gerenciador de Anúncios), via use_unified_attribution_setting.</li>
              <li><strong className="font-semibold text-ink">Data da conversão:</strong> contada na data da impressão do anúncio (action_report_time=impression). Por isso números recentes podem subir nos dias seguintes.</li>
              <li><strong className="font-semibold text-ink">Reconciliação:</strong> a cada sincronização, os últimos dias são reimportados e substituem os anteriores.</li>
              <li><strong className="font-semibold text-ink">Fuso e moeda:</strong> datas no fuso da conta de anúncios; valores na moeda da conta. Contas com moedas diferentes não são somadas.</li>
              <li><strong className="font-semibold text-ink">Dia atual:</strong> sempre parcial. Os períodos padrão terminam ontem.</li>
              <li><strong className="font-semibold text-ink">Comparação:</strong> o período anterior tem o mesmo número de dias e termina no dia anterior ao início do período atual.</li>
            </ul>
          </Card>
          <Card>
            <CardHeader title="Eventos usados nesta conta" description="Um único action_type por métrica, escolhido pela prioridade abaixo. Tipos sobrepostos nunca são somados." />
            <ul className="flex flex-col gap-3 px-5 pb-5 pt-3 text-[13px]">
              {Object.entries(ACTION_PRIORITY).map(([k, list]) => {
                const chosen = (map as Record<string, string | null>)[k];
                return (
                  <li key={k}>
                    <p className="font-medium text-ink">
                      {ACTION_LABEL[k]}: <span className={chosen ? "text-accent-text" : "text-ink-3"}>{chosen ?? "não rastreado nesta conta"}</span>
                    </p>
                    <p className="text-[12px] text-ink-3">Prioridade: {list.join(" › ")}</p>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        <Card>
          <CardHeader title="Vendas: atribuídas × confirmadas" />
          <ul className="grid grid-cols-1 gap-x-8 gap-y-2.5 px-5 pb-5 pt-3 text-[13.5px] leading-relaxed text-ink-2 md:grid-cols-2">
            <li>Compras e receita só existem se o pixel ou a API de Conversões enviarem eventos de compra com valor.</li>
            <li>Conversas no WhatsApp, Messenger ou Direct não são vendas confirmadas.</li>
            <li>Checkout e CRM podem fornecer vendas confirmadas quando conectados (planejado).</li>
            <li>Vendas atribuídas pela Meta e vendas confirmadas no seu sistema podem divergir: janelas, múltiplos canais e eventos duplicados ou perdidos.</li>
            <li>Uma venda do seu sistema só pode ser ligada a um anúncio com identificadores (UTM, fbclid) e lógica de atribuição própria.</li>
            <li>ROAS não é lucro nem ROI.</li>
          </ul>
        </Card>
      </main>
    </>
  );
}
