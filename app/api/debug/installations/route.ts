// app/api/debug/installations/route.ts
import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';

export async function GET() {
  const raw = await kvGet('installations');
  return NextResponse.json({ raw });
}
