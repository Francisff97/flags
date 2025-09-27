// app/api/kv/ping/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || 'N/A';
  return NextResponse.json({
    ok: true,
    kv_url: url,
    hint: 'Assicurati che PROD/Preview/Dev puntino allo stesso DB se vuoi vedere gli stessi dati',
    now: Date.now(),
  });
}
