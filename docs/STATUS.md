# Status: o que funciona, o que foi testado e o que depende de terceiros

Data: 24/09/2026. Nada aqui afirma prontidão para produção.

## Funciona e foi verificado neste ambiente

| Área | Como foi verificado |
|---|---|
| Cadastro, login, logout, sessões, recuperação de senha com revogação de sessões | Playwright E2E contra o app rodando |
| Workspaces, papéis (proprietário/admin/leitor), convites, troca de workspace | Testes de integração + uso manual |
| Isolamento entre clientes (URL, API de status, exportação, jobs, cache, seleção de contas) | Vitest (Postgres real) + Playwright (dois usuários) |
| Fluxo OAuth: URL oficial com `config_id`, `state` de uso único (usuário, navegador, validade, papel), troca no servidor, token de longa duração, SUAT, falta de `ads_read`, cancelamento | Vitest com Graph API simulada; redirecionamento real para `facebook.com/v26.0/dialog/oauth` conferido no navegador com credenciais falsas |
| Criptografia do token (AES-GCM com AAD), redação de logs, `appsecret_proof`, `signed_request` | Vitest |
| Sincronização: estrutura, paginação (sem reaproveitar token da URL de paginação), relatório assíncrono, compras sem dupla contagem, placeholders de anúncios excluídos, reconciliação que remove linhas, idempotência, limite de requisição com nova tentativa, erro temporário re-tentável, token expirado sem nova tentativa, workspace demo nunca sincroniza | Vitest com Graph API simulada |
| Fila: agendador, deduplicação, processamento em background pelo pg-boss, cooldown de "Atualizar agora" | Vitest (pg-boss real no Postgres) + worker iniciado localmente |
| Fórmulas, zero/indisponível/não rastreado, ROAS a partir de totais, períodos e fuso, funis (sem limitar taxas), ranking com limiares, alertas com regra | Vitest (19 testes de métricas) |
| Consistência do painel: série diária soma o total, campanhas somam o total, filtros de objetivo/campanha coerentes entre telas | Vitest sobre dados de demonstração |
| Interface: todas as telas em claro/escuro, desktop e 390 px, navegação por teclado, estados vazio/primeira sincronização/sem conexão/sem permissão/desatualizado/erro | Capturas reais com Chromium + E2E |
| `npm run lint`, `npm run typecheck`, `npm run build` | Sem erros |

Total: 53 testes Vitest e 4 testes Playwright passando.

- Redesenho visual (Visão geral, Recomendações, Funis, Criativos) conferido em capturas de tela desktop (claro/escuro) e celular com dados de demonstração.
- Recomendações de otimização com regras do Growth OS ([RECOMMENDATIONS.md](RECOMMENDATIONS.md)): testes unitários das regras e salvaguardas, teste de isolamento do status por workspace e teste E2E marcando uma recomendação como revisada.

## Implementado, mas NÃO executado contra a Meta real

- Troca de code, `debug_token`, `/me/adaccounts`, insights, relatórios assíncronos e revogação usam os endpoints documentados, mas só rodaram contra a simulação. Formatos reais podem ter diferenças (por exemplo, campos de criativo ausentes em certos formatos, comportamento de `/me/permissions` para system users).
- Cabeçalhos de uso e códigos de limite seguem a documentação; o comportamento sob carga real não foi observado.
- Callbacks de desautorização e exclusão de dados só foram testados com `signed_request` gerado localmente.

## Depende de credenciais, aprovação ou infraestrutura

1. App Meta do tipo Business, configuração do Facebook Login for Business e as variáveis `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID` ([META_SETUP.md](META_SETUP.md)).
2. **Full access** da Marketing API + App Review de `ads_read` para ler contas de clientes; verificação da empresa.
3. Domínio HTTPS, URIs de redirecionamento e callbacks cadastrados.
4. SMTP (`SMTP_URL`) para e-mails em produção.
5. Hospedagem do processo `worker` sempre ativo (além do web) e backups do Postgres.

## Limitações conhecidas e próximos passos sugeridos
- Recomendações ainda não foram avaliadas com dados reais de uma conta: os limiares podem precisar de ajuste por nicho/ticket. Frequência por anúncio não é sincronizada, então “desgaste” é inferido pela queda de CTR. Remarketing é identificado pelo nome da campanha.

- Uma conta de anúncios por vez nas análises (por design, para não misturar moedas). Visão consolidada exigiria política de câmbio explícita.
- Alcance em intervalos personalizados não é consultado sob demanda (aparece "Sem dados").
- Prévia de criativo depende das URLs de miniatura da Meta, que expiram; não há cache de imagens.
- Checkout, CRM, GA4 e outras mídias estão apenas como "planejado" na interface.
- Recomendado antes de produção: RLS no Postgres, CSP, monitoramento de erros, cache compartilhado (ex.: Redis) se houver várias instâncias web, rotação de `TOKEN_ENCRYPTION_KEY`, teste com uma conta Meta real em modo de desenvolvimento.
