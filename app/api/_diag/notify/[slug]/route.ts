// app/api/_diag/notify/[slug]/route.ts
import { NextResponse } from 'next/server';
import { notifyPlatformRefresh } from '../../installations/[slug]/flags/route';

export async function GET(_req, { params }: { params: { slug: string } }) {
  await notifyPlatformRefresh(params.slug);
  return NextResponse.json({ ok: true });
}
