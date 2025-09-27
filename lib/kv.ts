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

function normalize(value: any): string {
  if (typeof value === 'string') {
    let v: any = value;
    for (let i = 0; i < 2; i++) {
      try {
        const parsed = JSON.parse(v);
        if (typeof parsed === 'string') { v = parsed; continue; }
        return JSON.stringify(parsed);
      } catch { break; }
    }
    return JSON.stringify(value);
  }
  if (value && typeof value === 'object') return JSON.stringify(value);
  return JSON.stringify(value);
}

export async function kvSet(key: string, value: any): Promise<void> {
  const str = normalize(value);
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

export async function kvDel(key: string): Promise<void> {
  await fetch(`${URL}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
}

/** Parse robusto: sbuccia una o due volte e unwrap di 'value'/'result' */
export function kvParseJSON(raw: string | null): any | null {
  if (!raw) return null;
  try {
    let x: any = JSON.parse(raw);
    // unwrap result/value comuni in Upstash/Gateway
    if (x && typeof x === 'object' && ('result' in x || 'value' in x)) {
      x = (x.result ?? x.value);
    }
    if (typeof x === 'string') {
      try { return JSON.parse(x); } catch { return x; }
    }
    return x;
  } catch {
    return null;
  }
}

export async function kvSetJSON(key: string, value: any): Promise<void> {
  await kvSet(key, value);
}
