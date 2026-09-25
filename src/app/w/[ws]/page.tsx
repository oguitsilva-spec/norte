import { redirect } from "next/navigation";
export default async function WsIndex({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  redirect(`/w/${ws}/visao-geral`);
}
