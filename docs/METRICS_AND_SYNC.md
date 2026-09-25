# Métricas e sincronização

## Grão e contexto dos dados

- **Tabela principal:** `insights_daily`, uma linha por **anúncio × dia** no fuso da conta, só com métricas **aditivas**.
- **Atribuição:** configuração de cada conjunto de anúncios (`use_unified_attribution_setting=true`), contada na data da impressão (`action_report_time=impression`). Exibida no cabeçalho de todas as telas.
- **Moeda e fuso:** sempre os da conta de anúncios. Todas as telas trabalham com **uma conta por vez**; contas de moedas diferentes nunca são somadas (não há política de câmbio).
- **Alcance e frequência** ficam em `reach_snapshots`, consultados na Meta para o **intervalo exato** dos períodos padrão (7/14/30/90 dias, mês atual, mês passado e seus períodos anteriores). Em intervalos personalizados, aparecem como "Sem dados" em vez de uma soma errada.
- **Posicionamentos** em `insights_placement_daily` (nível de campanha).

## Eventos da Meta sem dupla contagem

A Meta devolve vários `action_type` para o mesmo evento (`omni_purchase`, `purchase`, `offsite_conversion.fb_pixel_purchase`, `onsite_web_purchase`…). Somá-los triplicaria compras. Para cada métrica escolhemos **um** tipo canônico por conta, o de maior prioridade presente nos dados:

| Métrica | Prioridade |
|---|---|
| Compras / receita | omni_purchase › purchase › offsite_conversion.fb_pixel_purchase › onsite_web_purchase › onsite_conversion.purchase › app_custom_event.fb_mobile_purchase |
| Leads | lead › onsite_conversion.lead_grouped › offsite_conversion.fb_pixel_lead › onsite_conversion.lead |
| Conversas | onsite_conversion.messaging_conversation_started_7d |
| Visualização da página | omni_landing_page_view › landing_page_view |
| Carrinho | omni_add_to_cart › add_to_cart › offsite_conversion.fb_pixel_add_to_cart |
| Checkout | omni_initiated_checkout › initiate_checkout › offsite_conversion.fb_pixel_initiate_checkout |

As ações brutas ficam em `jsonb`; se o tipo canônico mudar, todo o histórico da conta é reprocessado (`reextractAccount`). A escolha nunca "rebaixa" por ausência momentânea. A tela **Dicionário de métricas** mostra o tipo escolhido em cada conta.

## Definições

| Métrica | Fórmula | Agregação |
|---|---|---|
| Investimento | Σ spend | aditiva |
| Compras | Σ tipo canônico de compra | aditiva |
| Receita atribuída | Σ action_values do tipo canônico | aditiva; **atribuída pela Meta**, não é faturamento confirmado |
| ROAS | receita atribuída ÷ investimento | recalculado dos totais; **nunca média de ROAS**; não é lucro/ROI |
| Custo por compra | investimento ÷ compras | recalculado dos totais |
| Ticket médio | receita ÷ compras | recalculado dos totais |
| CTR (link) | cliques no link ÷ impressões × 100 | recalculado |
| CPC (link) | investimento ÷ cliques no link | recalculado |
| CPM | investimento ÷ impressões × 1.000 | recalculado |
| Leads / CPL | Σ lead canônico · investimento ÷ leads | aditiva / recalculado |
| Conversas / custo por conversa | Σ messaging_conversation_started_7d · investimento ÷ conversas | conversa **não é venda** |
| Alcance / frequência | consulta do intervalo exato | **não somável** |

### Valores indisponíveis (nunca 0 disfarçado)

- **Sem dados:** não há linhas sincronizadas para o recorte.
- **n/d (denominador zero):** ex.: custo por compra sem compras.
- **Não rastreado:** a conta nunca registrou o evento (sem pixel/CAPI). Diferente de "0 compras".
- Na série diária, um dia dentro da cobertura sincronizada sem linhas é **zero real** (sem entrega); fora da cobertura é **sem dados**.

### Períodos

- Presets terminam **ontem** no fuso da conta. "Hoje" existe, mas é sempre marcado como parcial.
- Comparação: período anterior de **mesma duração**, imediatamente antes.
- Variação percentual com base zero não é calculada.

### Resultado principal por objetivo

O objetivo (ODAX e legados) define o resultado: Vendas → compras/ROAS/CPA; Cadastros → leads/CPL; Mensagens → conversas/custo por conversa (campanhas de engajamento ou leads com destino WhatsApp/Messenger/Direct ou otimização CONVERSATIONS); Reconhecimento → alcance/impressões/frequência/CPM; Tráfego/Engajamento → cliques. Sem filtro de objetivo, vale o objetivo com maior investimento no período. Leads qualificados e vendas confirmadas exigem CRM/checkout (planejados, sem integração falsa).

## Funis

- São **funis agregados de eventos (proxy)**: contagens da Meta no período, não coortes de usuários. A interface diz isso em todas as telas de funil.
- Taxas acima de 100% são exibidas como estão e sinalizadas; nada é limitado nem forçado a decrescer.
- Etapa sem evento na conta aparece como "Não rastreado" e sai do cálculo das taxas, com aviso.
- Aviso automático quando o funil mistura contagens de entrega (impressões, cliques) com conversões atribuídas.
- "Maior perda" considera apenas etapas pós-clique (impressão → clique é o CTR, sempre a maior queda).
- Funis são configuráveis (etapas, ordem, evento) e mapeáveis por campanha ou conjunto.

## Melhores anúncios

- Entram só anúncios com **investimento ≥ limiar** e **resultados ≥ limiar**. Padrões: gasto mínimo = custo por resultado da conta no período; 3 resultados (100 para cliques/impressões). Ambos configuráveis.
- Rótulos: **Alto volume** (top 25% em resultados entre os elegíveis) e **Alta eficiência** (ROAS ≥ 1,2× o da conta ou custo por resultado ≤ 0,8× o da conta). Os demais com gasto aparecem em "Dados insuficientes" com o motivo.
- Ranking descritivo, sem alegação de significância estatística. Só compara anúncios de campanhas do objetivo principal.

## Alertas (regras explícitas)

Cada alerta mostra métrica, período, comparação e a regra. Nenhum afirma causa.

| Alerta | Regra |
|---|---|
| ROAS abaixo da meta | ROAS do período < meta do workspace |
| CPA acima da meta | custo por compra > meta |
| Investimento sem compras | campanha de vendas com gasto ≥ max(2× CPA da conta, 5% do investimento) e 0 compras |
| Deterioração | ROAS −20% ou CPA +20% vs período anterior, com ≥ 10 compras em cada período |
| Possível gargalo | ≥ 200 cliques e visualizações/cliques < 60%; ≥ 30 checkouts e compras/checkouts < 25% (referências internas, eventos agregados) |
| Destaque | anúncio elegível, top 25% em volume e ≥ 20% mais eficiente que a conta |
| Dados desatualizados | última sincronização bem-sucedida > 3× o intervalo, ou conexão inativa |

## Sincronização

```
agendador (cron 1/min, worker) ──► sync_jobs vencidos ──► fila pg-boss "sync-account"
                                                             política stately + singletonKey = conta
"Atualizar agora" (cooldown por conta) ───────────────────►  (no máx. 1 na fila + 1 rodando por conta)
                                                                       │
                                                             runner (worker, concorrência 3)
   1. metadados da conta (moeda, fuso, status)
   2. estrutura: campanhas → conjuntos → anúncios (paginado, inclui arquivados)
   3. insights diários por anúncio: janela inicial (90 dias, em blocos de 30, assíncrono)
      ou incremental = últimos 7 dias (reconciliação) até hoje
   4. posicionamentos da mesma janela
   5. alcance/frequência dos períodos padrão (no máx. 1×/hora)
   6. status, cobertura (data_from/data_through), sync_runs
```

- **Intervalo configurável** por workspace: 5, 10, 15 (padrão), 30 ou 60 minutos, sujeito aos limites da Meta. É "quase em tempo real": a própria Meta consolida conversões com atraso.
- **Idempotência:** cada bloco de datas é **substituído atomicamente** (apaga e reinsere na mesma transação). Reexecutar produz o mesmo estado; linhas que a Meta deixou de retornar somem.
- **Retentativas:** dentro do cliente (até 4, backoff exponencial com jitter, respeitando `estimated_time_to_regain_access`) e na fila (até 6, backoff até 1 h). Erros de autenticação/permissão **não** são re-tentados: pausam e pedem ação do usuário.
- **Duplicatas:** bloqueadas pela fila (singletonKey) e pela checagem de execução aberta; execuções presas há mais de 1 h são liberadas.
- **Após falhas consecutivas** o agendador espaça as tentativas (até 6 h).
- **Frescor na interface:** "Última sincronização" (quando os dados da Meta chegaram), "Cobertura" (até que dia) e "Painel gerado em" (quando a página foi montada) são exibidos separadamente. Banner de dados desatualizados quando a última sincronização bem-sucedida passa de 3× o intervalo ou a conexão está inativa.
- **Cache de leitura:** em memória, 60 s, chave iniciada por workspace e conta e versionada pela última sincronização concluída.
- **Workspaces demo** nunca são sincronizados.
