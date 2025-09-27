// app/api/installations/[slug]/meta/route.ts
import { NextResponse } from 'next/server';
import { kvGet, kvSet, kvDel, kvParseJSON } from '@/lib/kv';
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

function cleanUrl(u?: string): string | undefined {
  if (!u || typeof u !== 'string') return undefined;
  return u.replace(/\/+$/,'');
}

// GET → solo oggetto pulito { platform_url } o {}
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();
  const raw = await kvGet(keyMeta(slug));
  const obj = safeParse(raw) || kvParseJSON(raw) || {};
  const platform_url = cleanUrl(obj?.platform_url);
  return NextResponse.json(platform_url ? { platform_url } : {});
}

// PUT → sovrascrive TUTTO con oggetto { platform_url }, fa read-after-write e ritorna ciò che c’è davvero
export async function PUT(req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();

  const raw = await req.text();
  const sig = req.headers.get('x-signature') ?? '';
  if (!verifySignature(raw, sig)) {
    return NextResponse.json({ ok:false, error:'invalid signature' }, { status:401 });
  }

  const body = safeParse(raw) || kvParseJSON(raw) || {};
  const platform_url = cleanUrl(body?.platform_url) || '';

  await kvSet(keyMeta(slug), { platform_url });   // <-- sovrascrivi oggetto pulito
  await upsertInstallation(slug);

  // read-after-write
  const savedRaw = await kvGet(keyMeta(slug));
  const savedObj = safeParse(savedRaw) || kvParseJSON(savedRaw) || {};
  const savedUrl = cleanUrl(savedObj?.platform_url);

  return NextResponse.json({
    ok: true,
    slug,
    platform_url: savedUrl || null,
    saved_raw: savedRaw,   // debug: vedi esattamente cosa c’è in KV
    saved_obj: savedObj,   // debug
  });
}

// DELETE → rimuove/azzera
export async function DELETE(_req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();
  await kvDel(keyMeta(slug));
  return NextResponse.json({ ok:true, slug, cleared:true });
}
