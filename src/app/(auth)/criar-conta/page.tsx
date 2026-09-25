import { Suspense } from "react";
import { SignUpForm } from "@/components/auth/auth-forms";

export const metadata = { title: "Criar conta" };

export default function Page() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
