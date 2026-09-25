# Norte · analytics de anúncios Meta (multi-tenant)

SaaS em que o cliente entra, conecta suas contas de anúncios da Meta (Facebook e Instagram) pelo fluxo oficial de autorização e acompanha, em um painel em português, investimento, compras, receita atribuída, ROAS, custo por compra, funis e melhores anúncios, atualizados em segundo plano.

> **Status honesto:** a integração com a Meta está implementada e testada contra uma Graph API simulada, mas **não foi executada contra a Meta real** neste ambiente (não há App ID/Secret nem App Review). Veja [`docs/STATUS.md`](docs/STATUS.md). Sem credenciais, o app oferece um **Modo demonstração** isolado e claramente identificado.

## Stack e por quê

| Camada | Escolha | Motivo |
|---|---|---|
| Web | **Next.js 16 (App Router) + React 19 + TypeScript** | Server Components para ler dados no servidor (segredos nunca vão ao navegador), Server Actions com proteção de origem para mutações. |
| Banco | **PostgreSQL + Drizzle ORM** (migrações SQL em `drizzle/`) | Modelo relacional multi-tenant; `numeric` para dinheiro; `jsonb` para ações brutas da Meta. |
| Autenticação | **Better Auth** (e-mail/senha, sessões em banco, recuperação de senha, rate limit) | Solução mantida, sem senha própria "caseira"; totalmente separada da autorização Meta. |
| Background | **pg-boss** (fila no próprio Postgres) + processo `worker` | Retentativas com backoff, deduplicação por `singletonKey`, cron; sem Redis. |
| UI | Tailwind v4 (tokens CSS claro/escuro), Radix (popover, dialog, dropdown, tooltip), Phosphor Icons, Recharts, Motion | Acessibilidade dos primitivos, gráficos legíveis, animações contidas com `prefers-reduced-motion`. |
| Testes | Vitest (unidade + integração com Postgres) e Playwright (E2E) | |

## Rodando localmente

Pré-requisitos: Node 20.9+ (testado em 22), PostgreSQL 16 (ou `docker compose up -d db`).

```bash
npm install
cp .env.example .env
# gere os segredos:
#   BETTER_AUTH_SECRET=$(openssl rand -hex 32)
#   TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)
createdb painel            # se não usar o docker compose
npm run db:migrate         # aplica drizzle/*.sql
npm run dev                # http://localhost:3000
npm run worker             # em outro terminal: agendador + sincronizações
```

Criar um usuário com workspace de demonstração já populado:

```bash
npm run db:seed-demo -- demo@norte.local "demonstracao-norte"
```

Ou crie uma conta em `/criar-conta` e clique em **Explorar o modo demonstração**.

Sem `SMTP_URL`, os e-mails (recuperação de senha, convites) ficam na tabela `mail_outbox` e aparecem no log do servidor. Em produção sem SMTP, nada é enviado e um erro é registrado.

### Testes

```bash
createdb painel_test
npm test                                   # testes: métricas, OAuth, sync, fila, isolamento
CHROME=/caminho/do/chrome npm run test:e2e # Playwright contra o servidor em :3000
npm run lint && npm run typecheck && npm run build
```

## Onde está cada coisa

```
src/
  app/                        rotas (pt-BR): /entrar, /criar-conta, /w/[ws]/visao-geral, campanhas, criativos, funis, conexoes, configuracoes, metricas
  app/api/meta/*              callback OAuth, desautorização e exclusão de dados (signed_request)
  app/api/w/[ws]/{status,export}  polling de sincronização e CSV — sempre com checagem de workspace
  server/tenancy/access.ts    ponto único de autorização (sessão + participação + papel)
  server/providers/meta/      cliente Graph API, OAuth, descoberta de contas, erros
  server/sync/                janela de sincronização, runner idempotente, agendador, "Atualizar agora"
  server/analytics/           consultas com escopo obrigatório (workspace + conta) e cache por versão
  server/demo/seed.ts         dados fictícios consistentes, em workspace próprio
  lib/metrics/                fórmulas, ações da Meta, ranking, alertas, funis (funções puras)
  worker/index.ts             processo de background
drizzle/                      migrações SQL
docs/                         configuração da Meta, métricas e sincronização, status
```

## Publicar

Passo a passo para o Railway (web + worker + Postgres): [`docs/DEPLOY_RAILWAY.md`](docs/DEPLOY_RAILWAY.md). O worker e as migrações usam só dependências de produção (`tsx`, `drizzle-orm`), e há uma rota de saúde em `/api/health`.

## Documentação

- [`docs/META_SETUP.md`](docs/META_SETUP.md) — app Meta, Facebook Login for Business, permissões, App Review, verificação da empresa, callbacks.
- [`docs/METRICS_AND_SYNC.md`](docs/METRICS_AND_SYNC.md) — definições de métricas, atribuição, agregação, funis, ranking, alertas e como a sincronização funciona.
- [`docs/SECURITY.md`](docs/SECURITY.md) — isolamento entre clientes, tokens, sessões, logs.
- [`docs/STATUS.md`](docs/STATUS.md) — o que funciona, o que foi testado e o que depende de credenciais ou aprovação.
