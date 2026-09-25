"use client";

import { useActionState, useTransition } from "react";
import { saveSettingsAction, inviteMemberAction, changeRoleAction, removeMemberAction, type ActionResult } from "@/server/actions/workspace";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClasses } from "@/components/ui/field";
import { cn } from "@/lib/cn";

function Msg({ s }: { s: ActionResult | null }) {
  if (!s) return null;
  return (
    <p role={s.ok ? "status" : "alert"} className={cn("text-[13px]", s.ok ? "text-good" : "text-critical")}>
      {s.ok ? s.message : s.error}
    </p>
  );
}

export function SettingsForm({ ws, disabled, v, currency }: { ws: string; disabled: boolean; currency: string; v: { name: string; roasTarget?: number | null; cpaTarget?: number | null; rankingMinSpend?: number | null; rankingMinResults?: number | null; syncIntervalMinutes?: number | null } }) {
  const [state, action, pending] = useActionState(saveSettingsAction.bind(null, ws), null);
  return (
    <form action={action} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Nome do workspace" htmlFor="name">
          <Input id="name" name="name" defaultValue={v.name} disabled={disabled} required minLength={2} maxLength={80} />
        </Field>
      </div>
      <Field label="Meta de ROAS (×)" htmlFor="roasTarget" hint="Usada nos alertas e no gráfico de ROAS. Deixe em branco para não usar.">
        <Input id="roasTarget" name="roasTarget" type="number" step="0.01" min="0" defaultValue={v.roasTarget ?? ""} disabled={disabled} inputMode="decimal" />
      </Field>
      <Field label={`Meta de custo por compra (${currency})`} htmlFor="cpaTarget" hint="Alerta quando o custo por compra do período ficar acima.">
        <Input id="cpaTarget" name="cpaTarget" type="number" step="0.01" min="0" defaultValue={v.cpaTarget ?? ""} disabled={disabled} inputMode="decimal" />
      </Field>
      <Field label={`Gasto mínimo para ranking (${currency})`} htmlFor="rankingMinSpend" hint="Em branco: usa o custo por resultado da conta no período.">
        <Input id="rankingMinSpend" name="rankingMinSpend" type="number" step="0.01" min="0" defaultValue={v.rankingMinSpend ?? ""} disabled={disabled} inputMode="decimal" />
      </Field>
      <Field label="Resultados mínimos para ranking" htmlFor="rankingMinResults" hint="Ex.: 3 compras. Evita premiar anúncios com pouca evidência.">
        <Input id="rankingMinResults" name="rankingMinResults" type="number" step="1" min="1" defaultValue={v.rankingMinResults ?? ""} disabled={disabled} inputMode="numeric" />
      </Field>
      <Field label="Intervalo de sincronização" htmlFor="syncIntervalMinutes" hint="Sujeito aos limites da Meta. Intervalos menores consomem mais cota.">
        <select id="syncIntervalMinutes" name="syncIntervalMinutes" defaultValue={String(v.syncIntervalMinutes ?? 15)} disabled={disabled} className={cn(inputClasses, "appearance-auto")}>
          {[5, 10, 15, 30, 60].map((m) => (
            <option key={m} value={m}>
              A cada {m} minutos
            </option>
          ))}
        </select>
      </Field>
      {!disabled ? (
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            Salvar configurações
          </Button>
          <Msg s={state} />
        </div>
      ) : null}
    </form>
  );
}

export function InviteForm({ ws }: { ws: string }) {
  const [state, action, pending] = useActionState(inviteMemberAction.bind(null, ws), null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end">
        <Field label="E-mail" htmlFor="invite-email">
          <Input id="invite-email" name="email" type="email" required placeholder="nome@empresa.com.br" />
        </Field>
        <Field label="Papel" htmlFor="invite-role">
          <select id="invite-role" name="role" defaultValue="viewer" className={cn(inputClasses, "appearance-auto")}>
            <option value="viewer">Leitor</option>
            <option value="admin">Administrador</option>
          </select>
        </Field>
        <Button type="submit" disabled={pending} className="h-10">
          Convidar
        </Button>
      </div>
      <Msg s={state} />
    </form>
  );
}

export function MemberActions({ ws, userId, role, canManage, isSelf }: { ws: string; userId: string; role: "owner" | "admin" | "viewer"; canManage: boolean; isSelf: boolean }) {
  const [pending, start] = useTransition();
  if (!canManage) return null;
  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Papel"
        defaultValue={role}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const r = await changeRoleAction(ws, userId, e.target.value as "owner");
            if (!r.ok) alert(r.error);
          })
        }
        className={cn(inputClasses, "h-8 w-[150px] appearance-auto text-[13px]")}
      >
        <option value="owner">Proprietário</option>
        <option value="admin">Administrador</option>
        <option value="viewer">Leitor</option>
      </select>
      {!isSelf ? (
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              if (!confirm("Remover esta pessoa do workspace?")) return;
              const r = await removeMemberAction(ws, userId);
              if (!r.ok) alert(r.error);
            })
          }
          className="h-8 rounded-[8px] px-2 text-[13px] text-critical hover:bg-critical-soft"
        >
          Remover
        </button>
      ) : null}
    </div>
  );
}
