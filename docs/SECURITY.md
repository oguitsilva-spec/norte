# Segurança e isolamento entre clientes

## Autenticação do SaaS
- Better Auth: e-mail + senha (mín. 10 caracteres, hash scrypt), sessões em banco com cookie httpOnly (`Secure` em produção), expiração em 14 dias.
- Rate limit: login 8/min, cadastro 5/min, recuperação 3 a cada 5 min.
- Recuperação de senha: token de uso único, 1 h, resposta idêntica exista ou não a conta; ao redefinir, **todas as sessões são revogadas** (testado em E2E).
- Login do SaaS e autorização da Meta são independentes: nunca pedimos nem armazenamos a senha do Facebook.

## Autorização e isolamento
- Papéis: **proprietário**, **administrador**, **leitor**. Leitores só visualizam; conectar/desconectar Meta, escolher contas, metas, funis e membros exigem admin; alterar proprietários exige proprietário; o último proprietário não pode ser removido.
- `requireWorkspace()` é chamado em toda página, Server Action e rota de API. Workspace alheio responde **404** (não revela existência).
- Toda consulta analítica recebe um escopo `{workspaceId, adAccountId}` e filtra pelos dois. IDs de campanha, conjunto, funil ou conta vindos da URL são validados contra o workspace; IDs de outro cliente são ignorados.
- Jobs carregam `workspaceId` e o runner confere que a conta pertence a ele antes de qualquer chamada.
- Exportação CSV passa pela mesma checagem e neutraliza fórmulas de planilha.
- Cache: chave sempre começa com workspace e conta.
- Testes cobrem troca de IDs em URL, API de status/exportação, jobs com workspace cruzado, cache e seleção de contas de outro cliente.
- Defesa adicional recomendada em produção: Row Level Security no Postgres usando o workspace da requisição (não implementado).

## Segredos
- Tokens da Meta: AES-256-GCM (`TOKEN_ENCRYPTION_KEY`), com o ID da conexão como dado autenticado. Em produção, guarde a chave em um cofre (KMS/Secrets Manager) e planeje rotação (o formato tem prefixo de versão `v1:`).
- App Secret só no servidor; `appsecret_proof` em toda chamada.
- `state` do OAuth: hash no banco, uso único, 10 min, vinculado ao usuário e a um cookie httpOnly `SameSite=Lax` restrito a `/api/meta/callback`.
- Logs em JSON passam por redação de tokens (`EAA…`), `access_token`, `client_secret`, `code`, `appsecret_proof`.
- Cabeçalhos: `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. Um CSP restritivo é recomendado no deploy.
