import { Suspense } from "react";
import { ResetForm } from "@/components/auth/auth-forms";

export const metadata = { title: "Nova senha" };

export default function Page() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
