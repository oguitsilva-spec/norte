export function authErrorMessage(code?: string | null, fallback?: string | null, status?: number): string {
  if (status === 429) return "Muitas tentativas. Aguarde um minuto e tente novamente.";
  switch (code) {
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "Já existe uma conta com este e-mail. Tente entrar ou recuperar a senha.";
    case "INVALID_EMAIL_OR_PASSWORD":
      return "E-mail ou senha incorretos.";
    case "PASSWORD_TOO_SHORT":
      return "A senha precisa ter pelo menos 10 caracteres.";
    case "PASSWORD_TOO_LONG":
      return "A senha é longa demais (máximo de 128 caracteres).";
    case "INVALID_EMAIL":
      return "Informe um e-mail válido.";
    case "INVALID_TOKEN":
      return "Este link de redefinição é inválido ou expirou. Peça um novo.";
    case "TOO_MANY_REQUESTS":
      return "Muitas tentativas. Aguarde um minuto e tente novamente.";
    default:
      // Mostra um código curto para facilitar o suporte, sem expor detalhes internos.
      return `Não foi possível concluir. Tente novamente.${code ? ` (código: ${code})` : status ? ` (erro ${status})` : ""}`;
  }
}
