import { cn } from "@/lib/cn";

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-medium text-ink", className)} {...p} />;
}

export const inputClasses =
  "h-10 w-full rounded-[10px] border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] hover:border-ink-3 focus:border-accent focus:shadow-[var(--ring)] focus:outline-none disabled:opacity-60";

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClasses, className)} {...p} />;
}

export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputClasses, "appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9", className)} style={{ backgroundImage: "var(--select-caret)" }} {...p}>
      {children}
    </select>
  );
}

export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: React.ReactNode; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-[12.5px] text-ink-3">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-[12.5px] font-medium text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}
