// lib/kv.ts
const URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

if (!URL || !TOKEN) {
  throw new Error('KV env missing: set KV_REST_API_URL & KV_REST_API_TOKEN (o UPSTASH_*)');
}

// GET: ritorna SEMPRE una stringa (o null) col valore salvato
export async function kvGet(key: string): Promise<string | null> {
  const res = await fetch(`${URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = await res.json(); // { result: "..." } in Upstash
  return typeof data?.result === 'string' ? data.result : null;
}

// SET: salva SEMPRE una stringa (ci penso io a stringify)
export async function kvSet(key: string, value: any): Promise<void> {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  const res = await fetch(`${URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ value: str }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`KV set failed (${res.status}): ${t}`);
  }
}
