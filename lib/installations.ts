// lib/installations.ts
import { kvGet, kvSet } from '@/lib/kv';

const KEY = 'installations';

// Parsers robusti: accettano "['demo']" oppure {"result":"..."} o {"value":"..."}
function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    // Caso 1: già una stringa con un array JSON
    if (raw.trim().startsWith('[')) {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    }
    // Caso 2: qualcuno ha salvato un oggetto {result: "..."} / {value: "..."}
    const obj = JSON.parse(raw);
    const inner = obj?.result ?? obj?.value ?? obj;
    if (typeof inner === 'string') {
      const arr = JSON.parse(inner);
      return Array.isArray(arr) ? arr : [];
    }
    if (Array.isArray(inner)) return inner as string[];
    return [];
  } catch {
    return [];
  }
}

export async function listInstallations(): Promise<string[]> {
  const raw = await kvGet(KEY);
  return parseList(raw);
}

export async function upsertInstallation(slug: string): Promise<void> {
  const s = (slug || '').trim().toLowerCase();
  if (!s) return;

  const current = await listInstallations();
  if (!current.includes(s)) {
    current.push(s);
    current.sort();
    // salvo come stringa JSON pulita
    await kvSet(KEY, current);
  }
}

// Alias per retro-compatibilità
export const addInstallation = upsertInstallation;
