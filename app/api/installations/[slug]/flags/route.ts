import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { upsertInstallation } from '@/lib/installations';
import { verifySignature } from '@/lib/sign';
export const runtime = 'nodejs';
import crypto from 'crypto';

/**
 * Costruisce la refresh URL:
 * - preferisce PLATFORM_REFRESH_URL se presente
 * - altrimenti PLATFORM_URL + /api/flags/refresh
 * - altrimenti https://VERCEL_URL + /api/flags/refresh
 * - forza sempre https e niente doppio /api/flags/refresh
 */
function resolveRefreshUrl(): string | null {
  let raw =
    (process.env.PLATFORM_REFRESH_URL || '').trim() ||
    (process.env.PLATFORM_URL || '').trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.trim()}` : '');

  if (!raw) return null;

  // rimuovi trailing slash
  raw = raw.replace(/\/+$/, '');

  // se è http, forziamo https
  raw = raw.replace(/^http:\/\//i, 'https://');

  // se non include già /api/flags/refresh, aggiungilo
  if (!/\/api\/flags\/refresh$/i.test(raw)) {
    raw = `${raw}/api/flags/refresh`;
  }

  return raw;
}

/** prende il secret (prima SIGNING_SECRET come hai settato in Vercel) */
function getSigningSecret(): string {
  return (
    (process.env.SIGNING_SECRET || '').trim() ||
    (process.env.FLAGS_SIGNING_SECRET || '').trim() ||
    (process.env.FLAGS_HMAC_SECRET || '').trim() ||
    (process.env.FLAGS_SHARED_SECRET || '').trim()
  );
}

export async function notifyPlatformRefresh(slug: string): Promise<void> {
  const url = resolveRefreshUrl();
  const secret = getSigningSecret();

  if (!url || !secret) {
    console.warn('[notify->platform] missing url/secret', {
      hasUrl: !!url,
      secretLen: secret?.length || 0,
    });
    return;
  }

  const body = JSON.stringify({ slug });
  const sig  = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  // log diagnostico (puoi rimuoverlo quando è ok)
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
      // NON seguire redirect: i 301 http->https spogliano body+headers
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Signature': sig,
        // esplicito: evita chunking su alcuni proxy
        'Content-Length': Buffer.byteLength(body).toString(),
      },
      body,
    });

    const text = await res.text().catch(() => '');
    console.warn('[notify->platform] <<', {
      status: res.status,
      ok: res.ok,
      preview: text.slice(0, 120),
    });
  } catch (e: any) {
    console.warn('[notify->platform] fetch error', { message: e?.message || String(e) });
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
    if (typeof raw !== 'string') return raw ?? null;
    let x: any = JSON.parse(raw);
    if (typeof x === 'string') {
      try { x = JSON.parse(x); } catch {}
    }
    return x ?? null;
  } catch { return null; }
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
  // fire & forget va bene; se preferisci attendere, metti "await"
  notifyPlatformRefresh(slug);

  // history
  try {
    const hPrev = await kvGet(keyHistory(slug));
    const arr: FlagsDoc[] = safeParse(hPrev) ?? [];
    arr.unshift(saved);
    if (arr.length > MAX_HISTORY) arr.length = MAX_HISTORY;
    await kvSet(keyHistory(slug), arr);
  } catch {}

  return NextResponse.json({ ok:true, slug, saved });
}