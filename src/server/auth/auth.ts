import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb, schema } from "@/server/db";
import { sendMail } from "@/server/mail";

/**
 * Autenticação do SaaS (e-mail + senha) via Better Auth:
 * sessões em banco com cookie httpOnly, hash de senha scrypt, rate limit,
 * recuperação de senha com token de uso único (1h) e revogação das sessões
 * ao redefinir. Totalmente separada da autorização da Meta.
 */
export const auth = betterAuth({
  appName: "Norte",
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.APP_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendMail(
        user.email,
        "Norte: redefinição de senha",
        `Olá, ${user.name}.\n\nRecebemos um pedido para redefinir sua senha. O link abaixo vale por 1 hora e só pode ser usado uma vez:\n\n${url}\n\nSe não foi você, ignore este e-mail: sua senha continua a mesma.`,
      );
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 8 },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 300, max: 3 },
    },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    cookiePrefix: "norte",
  },
  telemetry: { enabled: false },
  databaseHooks: {
    user: {
      create: {
        // Todo novo usuário recebe um workspace próprio, como proprietário.
        after: async (created) => {
          const { createWorkspace } = await import("@/server/tenancy/workspaces");
          const first = (created.name || "Meu").split(" ")[0];
          await createWorkspace(created.id, `Workspace de ${first}`);
        },
      },
    },
  },
  plugins: [nextCookies()],
});
