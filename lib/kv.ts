const URL   = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
if (!URL || !TOKEN) throw new Error('KV env missing: set KV_REST_API_URL & KV_REST_API_TOKEN');

export async function kvGet(key: string): Promise<string | null> {
  const res = await fetch(`${URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data?.result === 'string' ? data.result : null;
}

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
  if (!res.ok) throw new Error(`KV set failed (${res.status})`);
}

export async function kvDel(key: string): Promise<void> {
  await fetch(`${URL}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
}
// Prova a parsare JSON. Se il primo parse restituisce una stringa JSON,
// tenta un secondo parse. Se fallisce, torna null.
export function kvParseJSON(raw: string | null): any | null {
  if (!raw) return null;
  try {
    const once = JSON.parse(raw);
    if (typeof once === 'string') {
      try { return JSON.parse(once); } catch { return once; }
    }
    return once;
  } catch {
    return null;
  }
}

// Wrapper: salva sempre come JSON “pulito” (affidandosi a kvSet che già stringify-a)
export async function kvSetJSON(key: string, value: any): Promise<void> {
  await kvSet(key, value); // kvSet fa già JSON.stringify se non è stringa
}