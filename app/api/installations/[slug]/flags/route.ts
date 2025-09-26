// app/api/installations/[slug]/flags/route.ts
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

// ---------- GET ----------
export async function GET(
  req: Request,
  { params }: { params: { slug: string } }
) {
  const slug = (params.slug || '').toLowerCase();

  try {
    const raw = await kvGet(keyFlags(slug));
    if (!raw) {
      return NextResponse.json({ features: {} });
    }
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return NextResponse.json(parsed);
  } catch (e) {
    return NextResponse.json({ features: {} });
  }
}

// ---------- PUT ----------
export async function PUT(
  req: Request,
  { params }: { params: { slug: string } }
) {
  const slug = (params.slug || '').toLowerCase();

  const raw = await req.text();
  const sig = req.headers.get('x-signature') ?? '';
  if (!verifySignature(raw, sig)) {
    return NextResponse.json({ ok: false, error: 'invalid signature' }, { status: 401 });
  }

  let incoming: Partial<FlagsDoc>;
  try {
    incoming = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const incFeat: Features = (incoming as any)?.features ?? {};
  const nextFeat: Features = {
    addons:              !!incFeat.addons,
    email_templates:     !!incFeat.email_templates,
    discord_integration: !!incFeat.discord_integration,
    tutorials:           !!incFeat.tutorials,
    announcements:       !!incFeat.announcements,
  };

  let current: FlagsDoc = { features: {} };
  try {
    const prevRaw = await kvGet(keyFlags(slug));
    if (prevRaw) current = typeof prevRaw === 'string' ? JSON.parse(prevRaw) : prevRaw;
  } catch {}

  const merged: FlagsDoc = {
    ...current,
    features: { ...current.features, ...nextFeat },
    updated_at: Date.now(),
    updated_by: req.headers.get('x-actor') ?? undefined,
  };

  await kvSet(keyFlags(slug), merged);
  await upsertInstallation(slug);

  try {
    const hKey = keyHistory(slug);
    const prev = await kvGet(hKey);
    const arr: FlagsDoc[] = prev ? (typeof prev === 'string' ? JSON.parse(prev) : prev) : [];
    arr.unshift(merged);
    if (arr.length > MAX_HISTORY) arr.length = MAX_HISTORY;
    await kvSet(hKey, arr);
  } catch {}

  return NextResponse.json({ ok: true, slug, saved: merged });
}
