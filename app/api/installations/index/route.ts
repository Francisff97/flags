// app/api/installations/index/route.ts
import { NextResponse } from 'next/server';
import { listInstallations } from '@/lib/installations';

export async function GET() {
  const items = await listInstallations();
  return NextResponse.json({ ok: true, items });
}
