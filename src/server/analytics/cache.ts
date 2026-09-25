/**
 * Cache de leitura do painel, em memória do processo.
 * A chave SEMPRE começa com workspaceId e adAccountId e inclui a "versão"
 * dos dados (última sincronização concluída) - uma nova sincronização
 * invalida naturalmente o cache, e um workspace nunca lê o de outro.
 */
type Entry = { value: unknown; expires: number };
const store = new Map<string, Entry>();
const MAX = 500;

export async function cached<T>(parts: { workspaceId: string; adAccountId: string; version: string; key: string }, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const k = `${parts.workspaceId}:${parts.adAccountId}:${parts.version}:${parts.key}`;
  const hit = store.get(k);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.value as T;
  const value = await fn();
  if (store.size >= MAX) {
    const first = store.keys().next().value;
    if (first) store.delete(first);
  }
  store.set(k, { value, expires: now + ttlMs });
  return value;
}

export function invalidateAccount(workspaceId: string, adAccountId: string) {
  const prefix = `${workspaceId}:${adAccountId}:`;
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

export function cacheSize() {
  return store.size;
}
