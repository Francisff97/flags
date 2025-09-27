// lib/kv.ts
const URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

if (!URL || !TOKEN) {
  throw new Error('KV env missing: set KV_REST_API_URL & KV_REST_API_TOKEN (o UPSTASH_*)');
}

/** GET tollerante: accetta {result:"..."}, {value:"..."}, stringa pura o oggetto */
export async function kvGet(key: string): Promise<string | null> {
  const res = await fetch(`${URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;

  // prova prima a leggere come testo, poi decidi
  const text = await res.text();

  // Upstash REST normalmente risponde JSON; se è testo puro, lo restituiamo così com'è
  try {
    const j = JSON.parse(text);
    if (typeof j?.result === 'string') return j.result;
    if (typeof j?.value  === 'string') return j.value;

    // qualcuno potrebbe aver salvato un oggetto: lo ritrasformo in stringa JSON "pulita"
    return typeof j === 'string' ? j : JSON.stringify(j);
  } catch {
    // non era JSON → è una stringa già “pura”
    return text || null;
  }
}

/** Normalizza in UNA sola stringa JSON (evita doppi backslash) */
function normalize(value: any): string {
  if (typeof value === 'string') {
    // Se è una stringa che *sembra* JSON, “sbucciala” al massimo 2 volte
    let v: any = value;
    for (let i = 0; i < 3; i++) {
      try {
        const parsed = JSON.parse(v);
        if (typeof parsed === 'string') { v = parsed; continue; }
        return JSON.stringify(parsed);
      } catch {
        break;
      }
    }
    // non era JSON → salva la stringa nuda come JSON string
    return JSON.stringify(value);
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }

  return JSON.stringify(value);
}

/** SET sempre in formato canonico (una sola stringify) */
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

/** DEL helper */
export async function kvDel(key: string): Promise<void> {
  await fetch(`${URL}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
}

/** Parse sicuro: prova 2 volte se la prima restituisce ancora una stringa JSON */
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

/** Wrapper: salva sempre JSON “pulito” (si appoggia a kvSet che normalizza) */
export async function kvSetJSON(key: string, value: any): Promise<void> {
  await kvSet(key, value);
}
