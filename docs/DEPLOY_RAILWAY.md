# Publicar no Railway

O app tem três peças: **web** (Next.js), **worker** (sincronização em segundo plano) e **PostgreSQL** (dados e fila de jobs). As três ficam no mesmo projeto do Railway.

## 1. Preparar o repositório
Suba esta pasta para um repositório no GitHub (privado, de preferência). O arquivo `.env` não vai junto (está no `.gitignore`), e é assim que deve ser.

## 2. Criar o projeto
1. No Railway: **New Project → Deploy from GitHub repo** → escolha o repositório. Esse primeiro serviço será o **web**; ele usa o `railway.json` da raiz automaticamente (build `npm run build`, start `node scripts/railway-start.mjs`, checagem em `/api/health`). No web, esse comando aplica as migrações (com limite de 2 minutos) e depois inicia o site.
2. **New → Database → PostgreSQL** no mesmo projeto.
3. **New → GitHub repo** de novo (mesmo repositório) para criar o **worker** e dê a ele um nome que contenha `worker`. Ele usa o mesmo `railway.json`: o comando de início detecta o nome do serviço (ou a variável `SERVICE_ROLE=worker`) e roda `npm run worker`. Não preencha Custom Start Command nem caminho de config nos serviços.
4. No serviço **web**, em *Settings → Networking*, gere um domínio público (**Generate Domain**). Anote o endereço `https://….up.railway.app`.

## 3. Variáveis (Settings → Variables), nos DOIS serviços

| Variável | Valor |
|---|---|
| `DATABASE_URL` | referência ao Postgres: `${{Postgres.DATABASE_URL}}` |
| `APP_URL` | `https://SEU-DOMINIO` (o domínio do passo 2.4) |
| `BETTER_AUTH_URL` | igual ao `APP_URL` |
| `BETTER_AUTH_SECRET` | resultado de `openssl rand -hex 32` (o mesmo nos dois serviços) |
| `TOKEN_ENCRYPTION_KEY` | resultado de `openssl rand -base64 32` (o mesmo nos dois serviços; **não troque depois**, senão os tokens salvos deixam de abrir) |
| `SYNC_INTERVAL_MINUTES` | `15` |
| `SMTP_URL` / `MAIL_FROM` | opcional no primeiro teste; necessário para recuperação de senha e convites chegarem por e-mail |
| `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID` | deixe em branco no primeiro teste; preencha quando o app Meta existir ([META_SETUP.md](META_SETUP.md)) |

Dica: crie as variáveis em *Project Settings → Shared Variables* e referencie nos dois serviços.

## 4. Primeiro acesso
1. Faça o deploy dos dois serviços. No log do web deve aparecer `Migrações aplicadas.`; no do worker, `worker_started`.
2. Abra `https://SEU-DOMINIO/api/health` → `{"ok":true,"db":"ok"}`.
3. Abra `https://SEU-DOMINIO/criar-conta`, crie sua conta e clique em **Explorar o modo demonstração** para ver o painel completo com dados fictícios.

## 5. Ligar a Meta de verdade
No app da Meta, cadastre:
- URI de redirecionamento OAuth: `https://SEU-DOMINIO/api/meta/callback`
- Desautorização: `https://SEU-DOMINIO/api/meta/deauthorize`
- Exclusão de dados: `https://SEU-DOMINIO/api/meta/data-deletion`

Depois preencha `META_APP_ID`, `META_APP_SECRET` e `META_LOGIN_CONFIG_ID` nos dois serviços e faça novo deploy. Com o app Meta em modo de desenvolvimento, só pessoas com função no app conseguem autorizar; para contas de clientes é preciso o acesso completo (Full access) e o App Review de `ads_read`.

## Observações
- Sem `SMTP_URL` em produção, e-mails não são enviados (ficam na tabela `mail_outbox` e o erro aparece no log).
- O cache de leitura é em memória: com várias instâncias do web tudo funciona, mas cada uma terá seu próprio cache.
- O worker precisa ficar sempre ligado; sem ele nada sincroniza e o painel passa a mostrar os dados como desatualizados.
