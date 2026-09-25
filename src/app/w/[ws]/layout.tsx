import { Suspense } from "react";
import { requireWorkspace } from "@/server/tenancy/access";
import { listUserWorkspaces, setActiveWorkspace } from "@/server/tenancy/workspaces";
import { guard } from "@/server/page-context";
import { Sidebar } from "@/components/shell/sidebar";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const ctx = await guard(() => requireWorkspace(ws), ws);
  const workspaces = await listUserWorkspaces(ctx.userId);
  await setActiveWorkspace(ctx.userId, ctx.workspaceId);
  const current = workspaces.find((w) => w.id === ctx.workspaceId)!;
  return (
    <div className="flex min-h-[100dvh] flex-col lg:flex-row">
      <Suspense>
        <Sidebar ws={ctx.workspaceId} current={current} workspaces={workspaces} user={{ name: ctx.userName, email: ctx.userEmail }} />
      </Suspense>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
