import { kvGet, kvSet } from '@/lib/kv';

export async function GET() {
  // scrive e legge una chiave di test
  await kvSet('ping', { ok: true, at: Date.now() });
  const v = await kvGet('ping');
  return Response.json({ ping: v }, { status: 200 });
}
