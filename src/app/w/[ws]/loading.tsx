import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Carregando painel">
      <div className="flex flex-col gap-4 border-b border-line px-4 pb-5 pt-6 sm:px-8">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-9 w-52" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-40" />
        </div>
      </div>
      <div className="flex flex-col gap-5 px-4 py-6 sm:px-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-[14px] border border-line bg-surface p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-3 h-10 w-36" />
              <Skeleton className="mt-4 h-8 w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-[64px] w-full rounded-[14px]" />
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="rounded-[14px] border border-line bg-surface p-5 xl:col-span-2">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="mt-6 h-[260px] w-full" />
          </div>
          <div className="rounded-[14px] border border-line bg-surface p-5">
            <Skeleton className="h-4 w-40" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="mt-5 h-14 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
