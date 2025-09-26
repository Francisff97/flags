import { NextResponse } from 'next/server';
import { kvGet, kvSet, kvSetJSON, kvParseJSON } from '@/lib/kv';
import { verifySignature } from '@/lib/sign';
import { upsertInstallation } from '@/lib/installations';

const keyMeta = (slug: string) => `installations:${slug}:meta`;

// GET -> restituisce SEMPRE un oggetto pulito { platform_url: "..."} oppure {}
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();
  try {
    const raw = await kvGet(keyMeta(slug));
    const parsed = kvParseJSON(raw);
    return NextResponse.json(parsed && typeof parsed === 'object' ? parsed : {});
  } catch {
    return NextResponse.json({});
  }
}

// PUT -> salva SEMPRE oggetto pulito (no doppio stringify)
export async function PUT(req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();

  const raw = await req.text();
  const sig = req.headers.get('x-signature') ?? '';
  if (!verifySignature(raw, sig)) {
    return NextResponse.json({ ok:false, error:'invalid signature' }, { status:401 });
  }

  let body: any = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch {
    return NextResponse.json({ ok:false, error:'invalid json' }, { status:400 });
  }

  const platform_url =
    typeof body.platform_url === 'string'
      ? body.platform_url.replace(/\/+$/,'')
      : '';

  await kvSetJSON(keyMeta(slug), { platform_url });
  await upsertInstallation(slug);

  return NextResponse.json({ ok:true, slug, platform_url });
}

// DELETE -> per pulire (utile se hai già chiavi sporche)
export async function DELETE(req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();

  const raw = await req.text();
  const sig = req.headers.get('x-signature') ?? '';
  if (!verifySignature(raw, sig)) {
    return NextResponse.json({ ok:false, error:'invalid signature' }, { status:401 });
  }

  // Upstash "delete" compat via SET null/empty
  await kvSet(keyMeta(slug), '{}');
  return NextResponse.json({ ok:true, slug, deleted:true });
}