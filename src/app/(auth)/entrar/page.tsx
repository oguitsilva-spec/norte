import { Suspense } from "react";
import { SignInForm } from "@/components/auth/auth-forms";

export const metadata = { title: "Entrar" };

export default function Page() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
