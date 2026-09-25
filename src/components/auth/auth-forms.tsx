"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleNotch } from "@phosphor-icons/react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { authErrorMessage } from "./errors";

function useSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return { pending, setPending, error, setError };
}

function Heading({ title, sub }: { title: string; sub: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-ink">{title}</h1>
      <p className="mt-2 text-[14px] text-ink-2">{sub}</p>
    </div>
  );
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-[10px] border border-critical/30 bg-critical-soft px-3 py-2.5 text-[13px] text-critical">
      {error}
    </div>
  );
}

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const s = useSubmit();
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  return (
    <>
      <Heading title="Entrar" sub={<>Não tem conta? <Link className="font-medium text-accent-text hover:underline" href="/criar-conta">Criar conta</Link></>} />
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          s.setPending(true);
          s.setError(null);
          const { error } = await authClient.signIn.email({ email: String(fd.get("email")), password: String(fd.get("password")) });
          if (error) {
            s.setPending(false);
            s.setError(authErrorMessage(error.code, error.message));
            return;
          }
          router.replace(safeNext);
          router.refresh();
        }}
      >
        <FormError error={s.error} />
        <Field label="E-mail" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Senha" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <div className="-mt-1 text-right">
          <Link href="/recuperar-senha" className="text-[13px] font-medium text-accent-text hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        <Button type="submit" size="lg" disabled={s.pending}>
          {s.pending ? <CircleNotch className="h-4 w-4 animate-spin" /> : null}
          Entrar
        </Button>
      </form>
    </>
  );
}

export function SignUpForm() {
  const router = useRouter();
  const s = useSubmit();
  return (
    <>
      <Heading title="Criar conta" sub={<>Já tem conta? <Link className="font-medium text-accent-text hover:underline" href="/entrar">Entrar</Link></>} />
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const password = String(fd.get("password"));
          if (password.length < 10) {
            s.setError("A senha precisa ter pelo menos 10 caracteres.");
            return;
          }
          s.setPending(true);
          s.setError(null);
          const { error } = await authClient.signUp.email({ name: String(fd.get("name")).trim(), email: String(fd.get("email")).trim(), password });
          if (error) {
            s.setPending(false);
            s.setError(authErrorMessage(error.code, error.message));
            return;
          }
          router.replace("/app?bem-vindo=1");
          router.refresh();
        }}
      >
        <FormError error={s.error} />
        <Field label="Nome" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" required maxLength={80} />
        </Field>
        <Field label="E-mail de trabalho" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Senha" htmlFor="password" hint="Mínimo de 10 caracteres.">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <Button type="submit" size="lg" disabled={s.pending}>
          {s.pending ? <CircleNotch className="h-4 w-4 animate-spin" /> : null}
          Criar conta
        </Button>
        <p className="text-[12.5px] leading-relaxed text-ink-3">Você entra em um workspace próprio. Conectar a Meta é um passo separado, feito na tela oficial da Meta.</p>
      </form>
    </>
  );
}

export function ForgotForm() {
  const s = useSubmit();
  const [sent, setSent] = useState(false);
  if (sent)
    return (
      <>
        <Heading title="Verifique seu e-mail" sub="Se existir uma conta com esse endereço, enviamos um link para redefinir a senha. O link vale por 1 hora." />
        <Link href="/entrar" className="text-[14px] font-medium text-accent-text hover:underline">
          Voltar para o login
        </Link>
      </>
    );
  return (
    <>
      <Heading title="Recuperar senha" sub="Enviaremos um link de redefinição para o seu e-mail." />
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          s.setPending(true);
          s.setError(null);
          const { error } = await authClient.requestPasswordReset({ email: String(fd.get("email")), redirectTo: "/redefinir-senha" });
          s.setPending(false);
          // Resposta idêntica exista ou não a conta (não revela cadastros).
          if (error && error.code === "TOO_MANY_REQUESTS") return s.setError(authErrorMessage(error.code));
          setSent(true);
        }}
      >
        <FormError error={s.error} />
        <Field label="E-mail" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Button type="submit" size="lg" disabled={s.pending}>
          Enviar link
        </Button>
        <Link href="/entrar" className="text-center text-[13px] font-medium text-accent-text hover:underline">
          Voltar para o login
        </Link>
      </form>
    </>
  );
}

export function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const s = useSubmit();
  if (!token || params.get("error"))
    return (
      <>
        <Heading title="Link inválido" sub="Este link de redefinição é inválido ou expirou." />
        <Link href="/recuperar-senha" className="text-[14px] font-medium text-accent-text hover:underline">
          Pedir um novo link
        </Link>
      </>
    );
  return (
    <>
      <Heading title="Nova senha" sub="Ao salvar, todas as sessões abertas serão encerradas." />
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const a = String(fd.get("password"));
          if (a !== String(fd.get("confirm"))) return s.setError("As senhas não coincidem.");
          if (a.length < 10) return s.setError("A senha precisa ter pelo menos 10 caracteres.");
          s.setPending(true);
          s.setError(null);
          const { error } = await authClient.resetPassword({ newPassword: a, token });
          if (error) {
            s.setPending(false);
            return s.setError(authErrorMessage(error.code, error.message));
          }
          router.replace("/entrar?senha=redefinida");
        }}
      >
        <FormError error={s.error} />
        <Field label="Nova senha" htmlFor="password" hint="Mínimo de 10 caracteres.">
          <Input id="password" name="password" type="password" autoComplete="new-password" required />
        </Field>
        <Field label="Confirmar senha" htmlFor="confirm">
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </Field>
        <Button type="submit" size="lg" disabled={s.pending}>
          Salvar nova senha
        </Button>
      </form>
    </>
  );
}
