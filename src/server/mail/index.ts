import { getDb, schema } from "@/server/db";
import { log } from "@/server/security/redact";

/**
 * Envio de e-mail transacional. Com SMTP_URL configurado usa nodemailer;
 * sem ele (desenvolvimento), grava em mail_outbox e registra no log.
 */
export async function sendMail(to: string, subject: string, body: string) {
  const db = getDb();
  const [row] = await db.insert(schema.mailOutbox).values({ to, subject, body }).returning({ id: schema.mailOutbox.id });
  const smtp = process.env.SMTP_URL;
  if (!smtp) {
    if (process.env.NODE_ENV === "production") {
      log.error("SMTP_URL não configurado em produção: e-mail não enviado", { to, subject });
      return;
    }
    // Em desenvolvimento, o link aparece no console para permitir o teste do fluxo.
    console.log(`\n[mail:dev] Para: ${to}\n[mail:dev] Assunto: ${subject}\n${body}\n`);
    return;
  }
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport(smtp);
  await transport.sendMail({ from: process.env.MAIL_FROM, to, subject, text: body });
  const { eq } = await import("drizzle-orm");
  await db.update(schema.mailOutbox).set({ sentAt: new Date() }).where(eq(schema.mailOutbox.id, row.id));
}
