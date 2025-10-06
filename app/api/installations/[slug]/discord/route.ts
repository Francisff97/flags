// app/api/installations/[slug]/discord/route.ts
import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { verifySignature } from '@/lib/sign';
import { addInstallation } from '@/lib/installations';
export const runtime = 'nodejs'; // se non c’è già
import crypto from 'crypto';

function resolveRefreshUrl(): string | null {
  const url = process.env.PLATFORM_REFRESH_URL
    || (process.env.PLATFORM_URL ? `${process.env.PLATFORM_URL.replace(/\/+$/, '')}/api/flags/refresh` : '')
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/+$/, '')}/api/flags/refresh` : '');
  return url || null;
}

function getSigningSecret(): string {
  // prende il primo valorizzato tra questi (in ordine)
  return (
    (process.env.FLAGS_SIGNING_SECRET || '').trim() ||
    (process.env.FLAGS_HMAC_SECRET || '').trim() ||
    (process.env.FLAGS_SHARED_SECRET || '').trim()
  );
}

async function notifyPlatformRefresh(slug: string): Promise<void> {
  const url = resolveRefreshUrl();
  const secret = getSigningSecret();
  if (!url || !secret) return;

  const body = JSON.stringify({ slug });
  const sig = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  // LOG TEMPORANEO (rimuovi quando ok)
  console.warn('[notify->platform]', { url, slug, bodyLen: body.length, sigPreview: sig.slice(0, 12) });

  fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Signature': sig,
    },
    body,
  }).catch(() => {});
}


const keyOf = (slug: string) => `installation:${slug}:discord`;

export async function GET(
  _req: Request,
  { params }: { params: { slug: string } }
) {
  const raw = await kvGet(keyOf(params.slug));
  let data = { guild_id: '', channels: [] as string[] };
  try { if (raw) data = JSON.parse(raw); } catch {}
  return NextResponse.json({ ok: true, slug: params.slug, data });
}

export async function PUT(req: Request, { params }: { params: { slug: string } }) {
  const raw = await req.text();                                 // <-- LEGGI UNA VOLTA
  const sig = req.headers.get('x-signature') ?? '';
  if (!verifySignature(raw, sig)) {
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 });
  }

  let body: any = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch {
    return NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 });
  }

  const guild_id = typeof body.guild_id === 'string' ? body.guild_id : '';
  const channels  = Array.isArray(body.channels) ? body.channels.map(String) : [];

  await kvSet(keyOf(params.slug), { guild_id, channels });
  await addInstallation(params.slug);
  notifyPlatformRefresh(params.slug);
  return NextResponse.json({ ok: true, slug: params.slug, data: { guild_id, channels } });
}

export async function PATCH(req: Request, { params }: { params: { slug: string } }) {
  const raw = await req.text();                                 // <-- LEGGI UNA VOLTA
  const sig = req.headers.get('x-signature') ?? '';
  if (!verifySignature(raw, sig)) {
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 });
  }

  let patch: any = {};
  try { patch = raw ? JSON.parse(raw) : {}; } catch {
    return NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 });
  }

  const currentRaw = await kvGet(keyOf(params.slug));
  let current = { guild_id: '', channels: [] as string[] };
  try { if (currentRaw) current = JSON.parse(currentRaw); } catch {}

  const next = {
    guild_id: typeof patch.guild_id === 'string' ? patch.guild_id : current.guild_id,
    channels: Array.isArray(patch.channels) ? patch.channels.map(String) : current.channels,
  };

  await kvSet(keyOf(params.slug), next);
  return NextResponse.json({ ok: true, slug: params.slug, data: next });
}
