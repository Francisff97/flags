// app/api/installations/[slug]/flags/route.ts
import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { upsertInstallation } from '@/lib/installations';
import { verifySignature } from '@/lib/sign';
import { headers } from 'next/headers';
import crypto from 'crypto';

export const runtime = 'nodejs';

// ————— helpers —————
function normalizeBaseUrl(base: string): string {
  let b = (base || '').trim();
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b;      // dominio nudo -> https
  b = b.replace(/^http:\/\//i, 'https://');              // forza https
  b = b.replace(/\/+$/, '');                             // no trailing slash
  return b;
}

function getSigningSecret(): string {
  return (
    (process.env.FLAGS_SIGNING_SECRET ?? '').trim() ||
    (process.env.SIGNING_SECRET ?? '').trim() ||
    (process.env.FLAGS_HMAC_SECRET ?? '').trim() ||
    (process.env.FLAGS_SHARED_SECRET ?? '').trim()
  );
}

/**
 * Base URL del server flags corrente. Priorità:
 * 1) header x-forwarded-proto/host (affidabile su Vercel)
 * 2) FLAGS_BASE_URL
 * 3) PLATFORM_URL
 * 4) VERCEL_URL
 */
function getSelfBaseFromRequest(): string | null {
  try {
    const h = headers();
    const proto = (h.get('x-forwarded-proto') || 'https').split(',')[0].trim();
    const host  = (h.get('x-forwarded-host')  || h.get('host') || '').split(',')[0].trim();
    if (host) return normalizeBaseUrl(`${proto}://${host}`);
  } catch {}
  const envBase =
    (process.env.FLAGS_BASE_URL ?? '') ||
    (process.env.PLATFORM_URL ?? '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  return envBase ? normalizeBaseUrl(envBase) : null;
}

// prende platform_url dall’endpoint meta dello stesso flags server
async function fetchPlatformUrlFromMeta(slug: string): Promise<string | null> {
  const selfBase = getSelfBaseFromRequest();
  if (!selfBase) {
    console.warn('[notify->platform] no self base url to reach /meta');
    return null;
  }
  const metaUrl = `${selfBase}/api/installations/${encodeURIComponent(slug)}/meta`;
  try {
    const r = await fetch(metaUrl, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!r.ok) {
      console.warn('[notify->platform] meta fetch not ok', { slug, status: r.status });
      return null;
    }
    const j = await r.json();
    const platformUrl = (j?.platform_url ?? '').toString().trim();
    return platformUrl ? normalizeBaseUrl(platformUrl) : null;
  } catch (e: any) {
    console.warn('[notify->platform] meta fetch error', e?.message || String(e));
    return null;
  }
}

async function notifyPlatformRefresh(slug: string): Promise<void> {
  const platformBase = await fetchPlatformUrlFromMeta(slug);
  const secret = getSigningSecret();

  // diag minimo (niente valori sensibili, solo lunghezze e preview)
  const testBody = JSON.stringify({ slug });
  const testHmac = secret ? crypto.createHmac('sha256', secret).update(testBody, 'utf8').digest('hex').slice(0, 12) : '';
  console.warn('[notify->platform][diag]', {
    hasPlatform: !!platformBase,
    secretLen: secret.length,
    bodyLen: testBody.length,
    hmac12: testHmac,
  });

  if (!platformBase || !secret) return;

  const url = `${platformBase}/api/flags/refresh`;
  const sig = crypto.createHmac('sha256', secret).update(testBody, 'utf8').digest('hex');

  console.warn('[notify->platform] >>', {
    url,
    slug,
    sig12: sig.slice(0, 12),
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'error',               // evitiamo redirect che spogliano body/headers
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Signature': sig,
        'Content-Length': Buffer.byteLength(testBody).toString(),
        'User-Agent': 'flags-server/notify',
      },
      body: testBody,
      cache: 'no-store',
    });

    const preview = await res.text().catch(() => '');
    if (!res.ok) {
      console.warn('platform refresh not ok:', res.status, preview.slice(0, 200));
    } else {
      console.warn('platform refresh ok:', res.status, preview.slice(0, 200));
    }
  } catch (e: any) {
    console.warn('[notify->platform] fetch error', e?.message || String(e));
  }
}

// ————— tipi e chiavi —————
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

const keyFlags = (slug: string) => `flags:${slug}`;
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

// ————— GET —————
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

// ————— PUT (overwrite totale) —————
export async function PUT(req: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();

  const raw = await req.text();
  const sig = req.headers.get('x-signature') ?? '';
  if (!verifySignature(raw, sig)) {
    return NextResponse.json({ ok: false, error: 'invalid signature' }, { status: 401 });
  }

  const incoming = safeParse<Partial<FlagsDoc>>(raw) || {};
  const incFeat = (incoming as any)?.features ?? {};

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

  // fire-and-forget (va bene non attendere)
  await notifyPlatformRefresh(slug);

  // history (compatta)
  try {
    const hPrev = await kvGet(keyHistory(slug));
    const arr: FlagsDoc[] = safeParse(hPrev) ?? [];
    arr.unshift(saved);
    if (arr.length > MAX_HISTORY) arr.length = MAX_HISTORY;
    await kvSet(keyHistory(slug), arr);
  } catch {}

  return NextResponse.json({ ok: true, slug, saved });
}
