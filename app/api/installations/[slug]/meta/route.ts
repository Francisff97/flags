// app/api/installations/[slug]/meta/route.ts
import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { verifySignature } from '@/lib/sign';
import { upsertInstallation } from '@/lib/installations';

const keyMeta = (slug: string) => `installations:${slug}:meta`;

function safeParse<T = any>(raw: any): T | null {
  try {
    if (typeof raw !== 'string') return raw ?? null;
    let x: any = JSON.parse(raw);
    if (typeof x === 'string') { try { x = JSON.parse(x); } catch {} }
    return x ?? null;
  } catch { return null; }
}

/** GET: restituisce sempre un oggetto pulito { platform_url?: string } */
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();
  const raw  = await kvGet(keyMeta(slug));
  const obj  = safeParse(raw) || {};
  const platform_url = typeof obj.platform_url === 'string'
    ? obj.platform_url.replace(/\/+$/,'')
    : undefined;
  return NextResponse.json(platform_url ? { platform_url } : {}, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** PUT: SOVRASCRIVE sempre con un oggetto pulito (no merge, no doppi slash) */
export async function PUT(req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();
  const raw  = await req.text();
  const sig  = req.headers.get('x-signature') ?? '';

  if (!verifySignature(raw, sig)) {
    return NextResponse.json({ ok:false, error:'invalid signature' }, { status:401 });
  }

  const body = safeParse(raw) || {};
  const platform_url = typeof body.platform_url === 'string'
    ? body.platform_url.replace(/\/+$/,'')
    : '';

  await kvSet(keyMeta(slug), { platform_url });   // ⟵ overwrite totale
  await upsertInstallation(slug);

  return NextResponse.json({ ok:true, slug, platform_url }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** DELETE: resetta il meta */
export async function DELETE(_req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();
  await kvSet(keyMeta(slug), {});                 // reset “pulito”
  return NextResponse.json({ ok:true, slug, cleared:true }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
