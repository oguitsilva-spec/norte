"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { ChartLineUp, Stack, ImageSquare, Funnel, Plugs, GearSix, List, X, CaretUpDown, Check, Flask, SignOut, BookOpenText, CircleNotch } from "@phosphor-icons/react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/cn";
import { authClient } from "@/lib/auth-client";
import { createDemoAction } from "@/server/actions/workspace";

type WS = { id: string; name: string; isDemo: boolean; role: string };

const NAV = [
  { href: "visao-geral", label: "Visão geral", icon: ChartLineUp },
  { href: "campanhas", label: "Campanhas", icon: Stack },
  { href: "criativos", label: "Criativos", icon: ImageSquare },
  { href: "funis", label: "Funis", icon: Funnel },
  { href: "conexoes", label: "Conexões", icon: Plugs },
  { href: "configuracoes", label: "Configurações", icon: GearSix },
  { href: "metricas", label: "Dicionário de métricas", icon: BookOpenText },
];

const ROLE_LABEL: Record<string, string> = { owner: "Proprietário", admin: "Administrador", viewer: "Leitor" };

function NavLinks({ ws, onNavigate }: { ws: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  // Preserva filtros globais ao trocar de tela.
  const keep = new URLSearchParams();
  for (const k of ["conta", "periodo", "de", "ate", "campanha", "objetivo"]) {
    const v = sp.get(k);
    if (v) keep.set(k, v);
  }
  const qs = keep.toString() ? `?${keep}` : "";
  return (
    <nav aria-label="Principal" className="flex flex-col gap-0.5">
      {NAV.map((n) => {
        const active = pathname.startsWith(`/w/${ws}/${n.href}`);
        const Icon = n.icon;
        return (
          <Link
            key={n.href}
            href={`/w/${ws}/${n.href}${["conexoes", "configuracoes", "metricas"].includes(n.href) ? "" : qs}`}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-[14px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink",
              active && "bg-surface text-ink shadow-card ring-1 ring-line",
            )}
          >
            <Icon size={18} weight={active ? "fill" : "regular"} className={cn("text-ink-3 group-hover:text-ink-2", active && "text-accent-text")} />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

function WorkspaceSwitcher({ current, workspaces }: { current: WS; workspaces: WS[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="flex w-full items-center gap-2.5 rounded-[10px] border border-line bg-surface px-2.5 py-2 text-left transition-colors hover:border-line-strong">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-[13px] font-semibold", current.isDemo ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent-text")}>
          {current.isDemo ? <Flask size={16} weight="bold" /> : current.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-ink">{current.name}</span>
          <span className="block text-[12px] text-ink-3">{current.isDemo ? "Demonstração" : ROLE_LABEL[current.role]}</span>
        </span>
        {pending ? <CircleNotch size={14} className="animate-spin text-ink-3" /> : <CaretUpDown size={14} className="text-ink-3" />}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="start" sideOffset={6} className="z-50 w-[260px] rounded-[12px] border border-line bg-surface p-1.5 shadow-pop">
          <Dropdown.Label className="px-2 pb-1 pt-1.5 text-[12px] font-medium text-ink-3">Workspaces</Dropdown.Label>
          {workspaces.map((w) => (
            <Dropdown.Item
              key={w.id}
              disabled={pending}
              // Navega direto: o layout do workspace valida o acesso e grava a escolha.
              onSelect={() => {
                if (w.id !== current.id) start(() => router.push(`/w/${w.id}/visao-geral`));
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-2 py-2 text-left text-[13.5px] text-ink outline-none data-[highlighted]:bg-surface-2"
            >
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {w.isDemo ? <span className="text-[11.5px] text-warn">demo</span> : null}
              {w.id === current.id ? <Check size={16} weight="bold" className="text-accent-text" /> : null}
            </Dropdown.Item>
          ))}
          <Dropdown.Separator className="my-1 h-px bg-line" />
          <Dropdown.Item
            disabled={pending}
            onSelect={() => start(() => createDemoAction())}
            className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-2 py-2 text-left text-[13.5px] text-ink-2 outline-none data-[highlighted]:bg-surface-2"
          >
            <Flask size={16} /> Novo workspace de demonstração
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

function UserBlock({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2.5 border-t border-line pt-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-[13px] font-semibold text-ink-2 ring-1 ring-line">{name.slice(0, 1).toUpperCase()}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{name}</span>
        <span className="block truncate text-[12px] text-ink-3">{email}</span>
      </span>
      <button
        aria-label="Sair"
        title="Sair"
        className="grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 hover:bg-surface-2 hover:text-ink"
        onClick={async () => {
          await authClient.signOut();
          router.replace("/entrar");
          router.refresh();
        }}
      >
        <SignOut size={17} />
      </button>
    </div>
  );
}

export function Sidebar(props: { ws: string; current: WS; workspaces: WS[]; user: { name: string; email: string } }) {
  const [open, setOpen] = useState(false);
  const body = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col gap-5">
      <div className="px-1 pt-1">
        <Logo />
      </div>
      <WorkspaceSwitcher current={props.current} workspaces={props.workspaces} />
      <NavLinks ws={props.ws} onNavigate={onNavigate} />
      <div className="mt-auto flex flex-col gap-3">
        <ThemeToggle className="self-start" />
        <UserBlock {...props.user} />
      </div>
    </div>
  );
  return (
    <>
      <aside className="sticky top-0 hidden h-[100dvh] w-[248px] shrink-0 border-r border-line bg-page px-3 py-4 lg:block">{body()}</aside>
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-page/90 px-4 backdrop-blur lg:hidden">
        <Logo />
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger aria-label="Abrir menu" className="grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-surface text-ink">
            <List size={18} />
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
            <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[86vw] max-w-[300px] border-r border-line bg-page px-3 py-4 shadow-pop">
              <Dialog.Title className="sr-only">Menu</Dialog.Title>
              <Dialog.Close aria-label="Fechar menu" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 hover:bg-surface-2">
                <X size={16} />
              </Dialog.Close>
              {body(() => setOpen(false))}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </>
  );
}
