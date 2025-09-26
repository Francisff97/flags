import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { verifySignature } from '@/lib/sign';
import { upsertInstallation } from '@/lib/installations';

const keyMeta = (slug: string) => `installations:${slug}:meta`;

// decode sicuro: se il valore è JSON stringato 1-2 volte, lo “sbuccia”
function safeParse<T = any>(raw: any): T | null {
  try {
    if (typeof raw !== 'string') return raw ?? null;
    let x: any = JSON.parse(raw);
    // se dopo il parse è ancora una stringa JSON, riprova una volta
    if (typeof x === 'string') {
      try { x = JSON.parse(x); } catch {}
    }
    return x ?? null;
  } catch { return null; }
}

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();
  try {
    const raw = await kvGet(keyMeta(slug));
    const obj = safeParse(raw) || {};
    return NextResponse.json(obj);
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

  const body = safeParse(raw) || {};
  const platform_url = typeof body.platform_url === 'string'
    ? body.platform_url.replace(/\/+$/,'')
    : '';

  // salva sempre un OGGETTO “pulito”
  await kvSet(keyMeta(slug), { platform_url });
  await upsertInstallation(slug);

  return NextResponse.json({ ok:true, slug, platform_url });
}

// opzionale: pulizia hard (DELETE)
export async function DELETE(_req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();
  await kvSet(keyMeta(slug), {}); // reset “pulito”
  return NextResponse.json({ ok:true, slug, cleared:true });
}