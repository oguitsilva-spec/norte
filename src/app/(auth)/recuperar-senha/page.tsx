import { Suspense } from "react";
import { ForgotForm } from "@/components/auth/auth-forms";

export const metadata = { title: "Recuperar senha" };

export default function Page() {
  return (
    <Suspense>
      <ForgotForm />
    </Suspense>
  );
}
