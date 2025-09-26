import { NextResponse } from 'next/server';
import { kvGet, kvSet, kvDel } from '@/lib/kv';
import { verifySignature } from '@/lib/sign';
import { upsertInstallation } from '@/lib/installations';

const keyMeta = (slug: string) => `installations:${slug}:meta`;

// GET -> oggetto pulito
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();
  const raw  = await kvGet(keyMeta(slug));
  try { return NextResponse.json(raw ? JSON.parse(raw) : {}); }
  catch { return NextResponse.json({}); }
}

// PUT -> salva oggetto, niente doppio stringify
export async function PUT(req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();

  const raw = await req.text();
  const sig = req.headers.get('x-signature') ?? '';
  if (!verifySignature(raw, sig)) {
    return NextResponse.json({ ok:false, error:'invalid signature' }, { status:401 });
  }

  let body: any = {};
  try { body = JSON.parse(raw); } 
  catch { return NextResponse.json({ ok:false, error:'invalid json' }, { status:400 }); }

  const platform_url = typeof body.platform_url === 'string'
    ? body.platform_url.replace(/\/+$/,'')
    : '';

  // 👇 qui il fix: passo l’OGGETTO a kvSet, NON JSON.stringify(...)
  await kvSet(keyMeta(slug), { platform_url });
  await upsertInstallation(slug);

  return NextResponse.json({ ok:true, slug, platform_url });
}

// DELETE -> pulizia chiave (firma del raw body)
export async function DELETE(req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();
  const raw  = await req.text();                // firma del raw effettivo
  const sig  = req.headers.get('x-signature') ?? '';
  if (!verifySignature(raw, sig)) {
    return NextResponse.json({ ok:false, error:'invalid signature' }, { status:401 });
  }
  await kvDel(keyMeta(slug));
  return NextResponse.json({ ok:true, slug });
}