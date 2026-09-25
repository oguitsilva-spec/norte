# Recomendações de otimização

Código: `src/lib/metrics/recommendations.ts` (funções puras) · testes: `tests/recommendations.test.ts`, `tests/recommendation-states.test.ts`, `e2e/app.spec.ts`.

As regras traduzem para código os critérios do **Growth OS Perpétuo** (skill `trafego-perpetuo`). O app **não** chama a skill em tempo de execução: a lógica aplicável foi implementada e documentada aqui. Não há serviço de IA envolvido.

## Onde aparecem
- **Visão geral → “O que merece atenção”**: as 3 recomendações em aberto de maior prioridade.
- **Recomendações** (menu): lista completa, com abas *Em aberto*, *Revisadas* e *Dispensadas e adiadas*, e a lista de análises que não puderam ser feitas (“Dados insuficientes”).

Cada cartão mostra título, prioridade, categoria, a entidade afetada (com link), uma evidência curta com números observados e o próximo passo. **Ver análise** abre o raciocínio, as métricas, o critério (limiares), a comparação usada, as limitações, o período analisado e o horário em que foi gerada.

As recomendações são recalculadas com **os mesmos filtros** da tela (conta, período, objetivo, campanha). Mudou o filtro, mudam as recomendações; cada cartão diz a qual período se refere.

## Regras

| Regra | Dispara quando | Próximo passo | Natureza |
|---|---|---|---|
| Compras não medidas | Há gasto em campanhas de vendas e nenhum evento de compra na conta | Configurar pixel/API de conversões | observação · alta |
| Compras sem valor | ≥ 5 compras e receita = 0 | Enviar `value`/`currency` | observação · alta |
| Investimento sem vendas (campanha) | Gasto ≥ max(2× custo por venda da conta, 5% do total) e 0 compras | Reduzir orçamento, revisar criativo/público; após 48h, pausar e subir novos | observação · alta |
| Revisar este anúncio | Anúncio do mesmo objetivo com gasto ≥ 2× o custo por resultado da conta e 0 resultados (conta com ≥ 5) | Pausar e subir um novo (“pausou 1, sobe outro”) | observação · média |
| Funil (de baixo para cima) | Taxa de compra < 10% (≥ 30 checkouts) · Taxa de checkout < 15% (≥ 300 visualizações) · Connect rate < 75% (≥ 200 cliques) · CTR < 0,8% (≥ 5.000 impressões) | Ações específicas por etapa (checkout, página/oferta, velocidade/pixel, criativo antes de público) | hipótese · a etapa mais próxima da venda é **alta**, as demais **média** |
| Metas não atingidas | ROAS < meta ou custo por venda > meta (metas do usuário) | Atacar o gargalo do funil primeiro e não aumentar orçamento | observação · média |
| Custo por venda subindo | Alta ≥ 20% vs período anterior, ≥ 10 vendas em cada período, período ≥ 7 dias | Reduzir orçamento e subir novos criativos | observação · média |
| Espaço para escalar | Meta do usuário atendida, custo por venda variando ≤ 5%, ≥ 10 vendas em cada período, período ≥ 7 dias | Aumentar 20–30% e manter a janela de análise; duplicar o conjunto no teto | observação · baixa |
| Defina suas metas | Há campanhas avaliáveis e nenhuma meta definida | Informar metas em Configurações | baixa |
| Possível desgaste do criativo | CTR ≥ 25% menor que no período anterior, ≥ 3.000 impressões em cada período, período ≥ 7 dias | Variações com o mesmo ângulo e gancho novo; se o custo subir, pausar | hipótese · média se o custo por resultado também subiu |
| Poucos anúncios ativos | < 6 anúncios ativos com entrega | Manter ≥ 6 e subir 5–10 criativos/semana | observação · baixa |
| Replicar o que funciona | Anúncio nos 25% com mais resultados e ≥ 20% mais eficiente que a conta, acima dos limiares do ranking | Novos criativos com o mesmo gancho, teste 1×1 (ABO) | observação · baixa |
| Sem remarketing identificado | ≥ 50 checkouts e nenhuma campanha ativa com nome de remarketing | Campanha ABO 7–30 dias, 4–6 anúncios de objeção, excluindo compradores | hipótese · baixa |

Ordenação: prioridade (alta → baixa) e, dentro dela, o gasto envolvido. No máximo 3 itens por regra.

## Salvaguardas
- **Volume mínimo** por regra; abaixo dele a regra não dispara e o motivo aparece em “Dados insuficientes”.
- **Tendência e escala exigem ≥ 7 dias** e volume nos dois períodos (mesmo número de dias).
- **Conversões atrasadas**: se o período toca os últimos dias de reconciliação (`SYNC_RECONCILIATION_DAYS`), a tela avisa e as análises de tendência registram a ressalva.
- Evento **não rastreado** não vira zero; período **sem dados** não vira zero.
- Metas só entram quando definidas pelo usuário; os benchmarks do Growth OS são mostrados como **referência**, não como meta.
- **Hipótese** (causa provável) é separada de **observação** (fato medido). Nada de confiança estatística, projeção de ganho ou causalidade.
- Sugestões **consultivas**: nenhum orçamento, anúncio ou campanha é alterado na Meta.

## Status por workspace
Tabela `recommendation_states` (chave: workspace + conta + `rec_key`, onde `rec_key = regra:entidade`).
- *Revisada*, *Dispensada* e *Lembrar depois* (7 dias; depois volta como nova).
- Só administradores e proprietários alteram; leitores veem.
- A ação valida que a conta pertence ao workspace da sessão; outro workspace não enxerga nem altera esses status (teste de isolamento).
