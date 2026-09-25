"use client";
import { useSyncExternalStore } from "react";
import { Sun, Moon, Desktop } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

type Mode = "system" | "light" | "dark";
const listeners = new Set<() => void>();

function read(): Mode {
  try {
    const t = localStorage.getItem("norte-theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function applyTheme(m: Mode) {
  try {
    if (m === "system") {
      localStorage.removeItem("norte-theme");
      delete document.documentElement.dataset.theme;
    } else {
      localStorage.setItem("norte-theme", m);
      document.documentElement.dataset.theme = m;
    }
  } catch {}
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function ThemeToggle({ className }: { className?: string }) {
  const mode = useSyncExternalStore(subscribe, read, () => "system" as Mode);
  const opts: Array<[Mode, React.ReactNode, string]> = [
    ["light", <Sun key="l" size={15} />, "Tema claro"],
    ["system", <Desktop key="s" size={15} />, "Tema do sistema"],
    ["dark", <Moon key="d" size={15} />, "Tema escuro"],
  ];
  return (
    <div role="radiogroup" aria-label="Tema" className={cn("inline-flex rounded-[10px] border border-line bg-surface-2 p-0.5", className)}>
      {opts.map(([m, icon, label]) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          aria-label={label}
          title={label}
          onClick={() => applyTheme(m)}
          className={cn("grid h-7 w-8 place-items-center rounded-[8px] text-ink-3 transition-colors hover:text-ink", mode === m && "bg-surface text-ink shadow-card")}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
