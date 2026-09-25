# Configuração da Meta (Facebook Login for Business + Marketing API)

Verificado na documentação oficial da Meta em **24/09/2026**. Itens marcados com *(verificar)* vieram de fontes secundárias ou de páginas que não carregaram durante a verificação; confirme no painel antes de ir para produção.

## Resumo do que o código espera

| Variável | Onde obter |
|---|---|
| `META_APP_ID` / `META_APP_SECRET` | App Dashboard → Configurações → Básico |
| `META_LOGIN_CONFIG_ID` | Facebook Login for Business → Configurações → ID da configuração |
| `META_GRAPH_API_VERSION` | Padrão `v26.0` (lançada em 29/07/2026). A v25.0 é de 18/02/2026; a v24.0 expira em 06/10/2026. |
| `APP_URL` | URL pública HTTPS do app (usada no redirect_uri e nos callbacks) |

Sem essas três primeiras variáveis o app funciona normalmente, mas a conexão Meta aparece como "não configurada" e apenas o Modo demonstração fica disponível. **Nenhum número é simulado em contas reais.**

## Passo a passo

1. **Criar o app** em developers.facebook.com com o tipo **Business** (Facebook Login for Business exige app do tipo empresa).
2. **Adicionar produtos:** *Facebook Login for Business* e *Marketing API*.
3. **Criar uma configuração** em Facebook Login for Business → Configurações:
   - **Tipo de token** (decisão importante):
     - **Token de usuário do sistema (Business Integration System User Access Token)** — recomendado para sincronização em segundo plano. Fica vinculado ao portfólio empresarial do cliente, exige *authorization code grant* e, por padrão, **não expira** (opcionalmente expira em 60 dias).
     - **Token de usuário** — vinculado à pessoa. O app troca o token curto por um de longa duração (~60 dias). **Não existe refresh token**: perto do vencimento a pessoa precisa reconectar. A tela de Conexões avisa com 10 dias de antecedência.
     O código detecta o tipo via `debug_token` e trata os dois.
   - **Ativos:** contas de anúncios.
   - **Permissões:** `ads_read`. Não peça `ads_management` (nenhuma funcionalidade escreve em campanhas). Adicione `business_management` somente se a descoberta de contas do portfólio exigir no seu caso *(verificar)*.
   - Copie o **ID da configuração** para `META_LOGIN_CONFIG_ID`.
4. **URI de redirecionamento OAuth válida:** `{APP_URL}/api/meta/callback` (HTTPS em produção; mantenha o modo estrito ativado).
5. **Callbacks obrigatórios** (Configurações → Avançado / Login):
   - Desautorização: `{APP_URL}/api/meta/deauthorize`
   - Solicitação de exclusão de dados: `{APP_URL}/api/meta/data-deletion`
   Ambos validam o `signed_request` com HMAC-SHA256 usando o App Secret.
6. **URL da política de privacidade e termos** no Básico do app (exigidos para ir ao modo ativo e para App Review).

## Níveis de acesso, App Review e verificação

- O acesso da Marketing API foi renomeado: "Standard/Advanced Access" agora é **"Limited access" / "Full access"** (changelog da Marketing API).
- **Limited access** (padrão ao adicionar o produto): serve para desenvolvimento e para as **contas de anúncios do próprio desenvolvedor**, com limites de requisição bem mais baixos.
- **Full access** é necessário para ler contas de **clientes**. Requisitos citados no changelog: ao menos **500 chamadas** da Marketing API em 15 dias e **taxa de erro < 15%** nas últimas 500 chamadas; o requisito de gravação de tela para essa elevação de nível foi removido. A permissão `ads_read` com acesso avançado também passa por **App Review** (descrição de uso e, em geral, demonstração do fluxo) *(verificar o formulário atual)*.
- **Verificação da empresa (Business Verification)** é exigida para acesso avançado a permissões e para dados sensíveis *(verificar se já concluída no seu portfólio)*.
- Enquanto o app estiver em modo de desenvolvimento, só pessoas com função no app (administradores, desenvolvedores, testadores) conseguem autorizar.

## Tokens e ciclo de vida (como o código trata)

| Situação | Tratamento |
|---|---|
| Troca do code | Sempre no servidor (`/api/meta/callback`), com `client_secret`; o navegador nunca vê token nem segredo. |
| `state` | Aleatório (32 bytes), salvo apenas como hash, uso único, expira em 10 min, vinculado ao usuário da sessão e a um cookie httpOnly do navegador. |
| Armazenamento | AES-256-GCM com `TOKEN_ENCRYPTION_KEY`; o ID da conexão é usado como dado autenticado (o ciphertext não serve em outra linha). |
| Chamadas | `appsecret_proof` (HMAC do token com o App Secret) em toda requisição autenticada. |
| Saúde | `debug_token` a cada 6 horas no worker e sob demanda ("Verificar agora"); atualiza validade, escopos e status. |
| Erro 190 (subcódigos 458/460/463…) | Conexão marcada como expirada/revogada, sincronização pausada sem novas tentativas, botão **Reconectar**. |
| Permissão removida (10, 200–299) | Conta marcada "Sem permissão"; mensagem explica como reautorizar. |
| Desconectar | Revoga a autorização na Meta (melhor esforço, tokens de usuário), apaga o token e pausa as agendas. Dados já importados permanecem. |
| Desautorização pelo usuário no Facebook | Callback marca as conexões como revogadas e apaga os tokens. |
| Exclusão de dados | Callback apaga conexões, contas e todo o histórico importado e devolve `url` + `confirmation_code`. |

## Leitura de dados

- **Descoberta:** `GET /me/adaccounts?fields=id,account_id,name,currency,timezone_name,account_status,business{id,name}` (paginado).
- **Estrutura:** `/{act}/campaigns`, `/{act}/adsets`, `/{act}/ads` (inclui criativo: `thumbnail_url`, `image_url`, `object_type`, `video_id`, `instagram_permalink_url`, `preview_shareable_link`).
- **Insights diários por anúncio:** `/{act}/insights` com `level=ad`, `time_increment=1`, `time_range`, campos `spend, impressions, inline_link_clicks, actions, action_values`, `use_unified_attribution_setting=true`, `action_report_time=impression`.
  - Janelas maiores que 14 dias usam **relatório assíncrono** (`POST /insights` → `report_run_id` → `async_status` até "Job Completed" → leitura paginada).
- **Posicionamentos:** `level=campaign` com `breakdowns=publisher_platform,platform_position`.
- **Alcance/frequência:** consultados para o intervalo exato (sem `time_increment`) nos períodos padrão do painel, porque não são somáveis.
- **Janelas de atribuição:** a Meta removeu as janelas `7d_view` e `28d_view` em 12/01/2026 *(fonte secundária; verificar)*. O produto usa a configuração de cada conjunto (unificada), a mesma do Gerenciador de Anúncios, e mostra isso na interface.

## Limites de requisição

- Cabeçalhos lidos a cada resposta: `X-Business-Use-Case-Usage` (call_count, total_cputime, total_time, `estimated_time_to_regain_access`), `X-Ad-Account-Usage`, `X-FB-Ads-Insights-Throttle`, `X-App-Usage`.
- Acima de 90% de uso o cliente desacelera; códigos 4, 17, 32, 613 e 80000–80014 viram erro "re-tentável" com espera baseada em `estimated_time_to_regain_access` ou backoff exponencial com jitter. Esperas longas voltam para a fila (pg-boss reagenda com backoff até 1 h).
- Fórmula publicada para ads_management/insights (por hora): Limited ≈ `600 + 400 × anúncios ativos`, Full ≈ `190000 + 400 × anúncios ativos` (menos erros). Com Limited access, prefira intervalos de 15 min ou mais.
- **Webhooks não trazem métricas de desempenho**; por isso a atualização é por sondagem agendada.

## Fontes

- [Facebook Login for Business](https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business)
- [Marketing API changelog (versões e níveis de acesso)](https://developers.facebook.com/documentation/ads-commerce/marketing-api/marketing-api-changelog)
- [Introducing Graph API v26.0 and Marketing API v26.0](https://developers.facebook.com/blog/post/2026/07/29/introducing-graph-api-v26-and-marketing-api-v26/)
- [Marketing API — autorização e níveis de acesso](https://developers.facebook.com/docs/marketing-api/overview/authorization)
- [Insights API — boas práticas e relatórios assíncronos](https://developers.facebook.com/docs/marketing-api/insights/best-practices)
- [Insights API — parâmetros](https://developers.facebook.com/docs/marketing-api/insights/parameters)
- [Limites de requisição da Graph API](https://developers.facebook.com/docs/graph-api/overview/rate-limiting)
- [Tokens de longa duração](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived)
- [Resumo Q2 2026 (fonte secundária: janelas de atribuição e retenção)](https://www.kitchn.io/blog/meta-marketing-api-q2-2026-update)
