import { describe, expect, it } from "vitest";
import { client, listCampaigns } from "@/server/providers/meta/api";

const cfg = (fetchImpl: (u: string) => Promise<Response>) => ({ appId: "1", appSecret: "s", configId: "c", version: "v26.0", fetchImpl });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe("listagem de estrutura em contas reais", () => {
  it("reduz o tamanho da página quando a Meta responde código 1", async () => {
    const limits: string[] = [];
    const f = async (u: string) => {
      const url = new URL(u);
      limits.push(url.searchParams.get("limit")!);
      if (Number(url.searchParams.get("limit")) > 50) return json({ error: { code: 1, error_subcode: 99, message: "An unknown error occurred" } }, 500);
      return json({ data: [{ id: "c1", name: "Campanha" }] });
    };
    const c = client(cfg(f), "tok");
    (c as unknown as { opts: { sleep: () => Promise<void> } }).opts.sleep = async () => {};
    const out = await listCampaigns(c, "act_1");
    expect(out).toHaveLength(1);
    expect(limits.at(-1)).toBe("50");
  });

  it("repete sem o filtro de status quando a Meta recusa (#100)", async () => {
    const f = async (u: string) =>
      new URL(u).searchParams.has("effective_status") ? json({ error: { code: 100, message: "Param effective_status must be one of" } }, 400) : json({ data: [{ id: "c1", name: "Campanha" }] });
    const out = await listCampaigns(client(cfg(f), "tok"), "act_1");
    expect(out).toHaveLength(1);
  });
});
