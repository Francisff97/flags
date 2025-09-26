import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { verifySignature } from '@/lib/sign';
import { upsertInstallation } from '@/lib/installations';

const keyMeta = (slug: string) => `installations:${slug}:meta`;

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();
  try {
    const raw = await kvGet(keyMeta(slug));
    return NextResponse.json(raw ? JSON.parse(raw) : {});
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

  let body: any = {};
  try { body = JSON.parse(raw); } catch {
    return NextResponse.json({ ok:false, error:'invalid json' }, { status:400 });
  }

  const platform_url = typeof body.platform_url === 'string'
    ? body.platform_url.replace(/\/+$/,'')
    : '';

  await kvSet(keyMeta(slug), JSON.stringify({ platform_url }));
  await upsertInstallation(slug);

  return NextResponse.json({ ok:true, slug, platform_url });
}