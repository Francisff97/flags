import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { upsertInstallation } from '@/lib/installations';
import { verifySignature } from '@/lib/sign';

export const runtime = 'nodejs';

import crypto from 'crypto';

/** Ricava la URL di refresh partendo dalla piattaforma dell’installazione; fallback su ENV. */
async function resolveRefreshUrl(slug: string): Promise<string | null> {
  try {
    const instRaw = await kvGet(`installations:${slug}`);
    const inst = instRaw ? (typeof instRaw === 'string' ? JSON.parse(instRaw) : instRaw) : null;

    let base =
      (inst?.platform_url ?? '').trim() ||
      (process.env.PLATFORM_REFRESH_URL || '').trim() || // se già completa, la normalizziamo sotto
      (process.env.PLATFORM_URL || '').trim() ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.trim()}` : '');

    if (!base) return null;

    // forza https e normalizza
    base = base.replace(/^http:\/\//i, 'https://').replace(/\/+$/, '');

    // se non termina con /api/flags/refresh, aggiungilo
    if (!/\/api\/flags\/refresh$/i.test(base)) {
      // se era già una PLATFORM_REFRESH_URL completa, ha già /api/flags/refresh
      // altrimenti la costruiamo
      base = base.endsWith('/api') ? `${base}/flags/refresh` : `${base}/api/flags/refresh`;
    }

    return base;
  } catch {
    return null;
  }
}

/** Secret per la firma */
function getSigningSecret(): string {
  return (
    (process.env.SIGNING_SECRET || '').trim() ||
    (process.env.FLAGS_SIGNING_SECRET || '').trim() ||
    (process.env.FLAGS_HMAC_SECRET || '').trim() ||
    (process.env.FLAGS_SHARED_SECRET || '').trim()
  );
}

/** Funzione interna: notifica la piattaforma dopo l’update dei flags. */
async function notifyPlatformRefresh(slug: string): Promise<void> {
  const url = await resolveRefreshUrl(slug);
  const secret = getSigningSecret();

  if (!url || !secret) {
    console.warn('[notify->platform] missing url/secret', {
      hasUrl: !!url,
      secretLen: secret?.length || 0,
      slug,
    });
    return;
  }

  const body = JSON.stringify({ slug });
  const sig  = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  console.warn('[notify->platform] >>', {
    url,
    slug,
    bodyLen: body.length,
    sigPreview: sig.slice(0, 12),
    secretLen: secret.length,
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'error', // evita redirect che spogliano body/headers
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Signature': sig,
        'Content-Length': Buffer.byteLength(body).toString(),
      },
      body,
    });

    const text = await res.text().catch(() => '');
    console.warn('[notify->platform] <<', {
      status: res.status,
      ok: res.ok,
      preview: text.slice(0, 160),
    });
  } catch (e: any) {
    console.warn('[notify->platform] fetch error', { message: e?.message || String(e), slug });
  }
}

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

function safeParse<T = any>(raw: any): T | null {
  try {
    if (raw == null) return null;
    if (typeof raw !== 'string') return raw as T;
    let x: any = JSON.parse(raw);
    if (typeof x === 'string') {
      try { x = JSON.parse(x); } catch {}
    }
    return x ?? null;
  } catch {
    return null;
  }
}

// ---------- GET ----------
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();
  try {
    const raw = await kvGet(keyFlags(slug));
    const parsed = safeParse<FlagsDoc>(raw);
    return NextResponse.json(parsed ?? { features: {} });
  } catch {
    return NextResponse.json({ features: {} });
  }
}

// ---------- PUT (OVERWRITE) ----------
export async function PUT(req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();

  const raw = await req.text();
  const sig = req.headers.get('x-signature') ?? '';
  if (!verifySignature(raw, sig)) {
    return NextResponse.json({ ok:false, error:'invalid signature' }, { status:401 });
  }

  const incoming = safeParse<Partial<FlagsDoc>>(raw) || {};
  const incFeat  = (incoming as any)?.features ?? {};

  const nextFeat: Features = {
    addons:              !!incFeat.addons,
    email_templates:     !!incFeat.email_templates,
    discord_integration: !!incFeat.discord_integration,
    tutorials:           !!incFeat.tutorials,
    announcements:       !!incFeat.announcements,
  };

  const saved: FlagsDoc = {
    features: nextFeat,
    updated_at: Date.now(),
    updated_by: req.headers.get('x-actor') ?? undefined,
  };

  await kvSet(keyFlags(slug), saved);
  await upsertInstallation(slug);

  // notifica asincrona (non blocco la response)
  notifyPlatformRefresh(slug);

  // history compatta
  try {
    const hPrev = await kvGet(keyHistory(slug));
    const arr: FlagsDoc[] = safeParse(hPrev) ?? [];
    arr.unshift(saved);
    if (arr.length > MAX_HISTORY) arr.length = MAX_HISTORY;
    await kvSet(keyHistory(slug), arr);
  } catch {}

  return NextResponse.json({ ok:true, slug, saved });
}