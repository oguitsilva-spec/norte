import { afterEach, describe, expect, it, vi } from "vitest";
import { client } from "@/server/providers/meta/api";

describe("cliente Meta em produção (sem fetchImpl injetado)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("usa o fetch global quando fetchImpl vem undefined", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "123", name: "Teste" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const c = client({ appId: "1", appSecret: "s", configId: "c", version: "v26.0", fetchImpl: undefined }, "tok");
    await expect(c.get<{ id: string }>("me", { fields: "id,name" })).resolves.toMatchObject({ id: "123" });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
