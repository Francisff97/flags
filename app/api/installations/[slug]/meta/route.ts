import { NextResponse } from 'next/server';
import { kvGet, kvSet, kvDel, kvParseJSON } from '@/lib/kv';
import { verifySignature } from '@/lib/sign';
import { upsertInstallation } from '@/lib/installations';

const keyMeta = (slug: string) => `installations:${slug}:meta`;

function cleanUrl(u?: string): string | undefined {
  if (!u || typeof u !== 'string') return undefined;
  return u.replace(/\/+$/,'');
}

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();
  try {
    const raw = await kvGet(keyMeta(slug));
    const obj = kvParseJSON(raw) || {};
    const platform_url = cleanUrl(
      typeof obj === 'string' ? kvParseJSON(obj)?.platform_url : obj?.platform_url
    );
    return NextResponse.json(platform_url ? { platform_url } : {});
  } catch {
    return NextResponse.json({});
  }
}

export async function PUT(req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();

  const raw = await req.text();
  const sig = req.headers.get('x-signature') ?? '';
  if (!verifySignature(raw, sig)) {
    return NextResponse.json({ ok:false, error:'invalid signature' }, { status:401 });
  }

  const incoming = kvParseJSON(raw) || {};
  const platform_url = cleanUrl(
    typeof incoming === 'string' ? kvParseJSON(incoming)?.platform_url : incoming?.platform_url
  ) || '';

  // SOVRASCRITTURA TOTALE (niente merge)
  await kvSet(keyMeta(slug), { platform_url });
  await upsertInstallation(slug);

  // read-after-write (debug)
  const savedRaw = await kvGet(keyMeta(slug));
  const savedObj = kvParseJSON(savedRaw) || {};
  const savedUrl = cleanUrl(savedObj?.platform_url) || null;

  return NextResponse.json({
    ok: true,
    slug,
    platform_url: savedUrl,
  });
}

export async function DELETE(_req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();
  await kvDel(keyMeta(slug));
  return NextResponse.json({ ok:true, slug, cleared:true });
}
