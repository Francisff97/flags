import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { upsertInstallation } from '@/lib/installations';
import { verifySignature } from '@/lib/sign';

type Features = {
  addons?: boolean;
  email_templates?: boolean;
  discord_integration?: boolean;
  tutorials?: boolean;
  announcements?: boolean;
};

type FlagsDoc = {
  features: Features;
  updated_at?: number;
  updated_by?: string;
};

const keyFlags   = (slug: string) => `flags:${slug}`;
const keyHistory = (slug: string) => `flags:${slug}:history`;
const MAX_HISTORY = 50;

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();
  try {
    const raw = await kvGet(keyFlags(slug));
    return NextResponse.json(raw ? JSON.parse(raw) : { features: {} });
  } catch {
    return NextResponse.json({ features: {} });
  }
}

export async function PUT(req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();

  const raw = await req.text();
  const sig = req.headers.get('x-signature') ?? '';
  if (!verifySignature(raw, sig)) {
    return NextResponse.json({ ok:false, error:'invalid signature' }, { status:401 });
  }

  let incoming: Partial<FlagsDoc> = {};
  try { incoming = JSON.parse(raw); } catch {
    return NextResponse.json({ ok:false, error:'invalid json' }, { status:400 });
  }

  const inc = (incoming.features ?? {}) as Features;
  const next: FlagsDoc = {
    features: {
      addons:              !!inc.addons,
      email_templates:     !!inc.email_templates,
      discord_integration: !!inc.discord_integration,
      tutorials:           !!inc.tutorials,
      announcements:       !!inc.announcements,
    },
    updated_at: Date.now(),
    updated_by: req.headers.get('x-actor') ?? undefined,
  };

  // OVERWRITE pulito (niente merge col passato)
  await kvSet(keyFlags(slug), JSON.stringify(next));
  await upsertInstallation(slug);

  // Storia (array di doc JSON)
  try {
    const prev = await kvGet(keyHistory(slug));
    const arr: FlagsDoc[] = prev ? JSON.parse(prev) : [];
    arr.unshift(next);
    if (arr.length > MAX_HISTORY) arr.length = MAX_HISTORY;
    await kvSet(keyHistory(slug), JSON.stringify(arr));
  } catch {}

  return NextResponse.json({ ok:true, slug, saved: next });
}