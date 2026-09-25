"use client";
import { useTransition } from "react";
import { buttonClasses } from "@/components/ui/button";

export function ConfirmSubmit({ action, label, message }: { action: () => Promise<void>; label: string; message: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={buttonClasses("danger", "sm")}
      onClick={() => {
        if (confirm(message)) start(() => action());
      }}
    >
      {label}
    </button>
  );
}
