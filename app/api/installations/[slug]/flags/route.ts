import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { upsertInstallation } from '@/lib/installations';
import { verifySignature } from '@/lib/sign';
export const runtime = 'nodejs'; // se non c’è già
import crypto from 'crypto';

function resolveRefreshUrl(): string | null {
  const url = process.env.PLATFORM_REFRESH_URL
    || (process.env.PLATFORM_URL ? `${process.env.PLATFORM_URL.replace(/\/+$/, '')}/api/flags/refresh` : '')
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/+$/, '')}/api/flags/refresh` : '');
  return url || null;
}

// --- helper: prende platform_url da /api/installations/:slug/meta ---
async function fetchPlatformUrlFromMeta(slug: string): Promise<string | null> {
  // base del server flags (questa app)
  const selfBase =
    (process.env.FLAGS_BASE_URL ?? '') ||
    (process.env.PLATFORM_URL ?? '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');

  if (!selfBase) {
    console.warn('[notify->platform] no self base url to reach /meta');
    return null;
  }

  const metaUrl = `${selfBase.replace(/\/+$/, '')}/api/installations/${encodeURIComponent(slug)}/meta`;

  try {
    const r = await fetch(metaUrl, { method: 'GET', headers: { 'Accept': 'application/json' } });
    if (!r.ok) {
      console.warn('[notify->platform] meta fetch not ok', { slug, status: r.status });
      return null;
    }
    const j = await r.json();
    const platformUrl = (j?.platform_url ?? '').toString().trim();
    return platformUrl || null;
  } catch (e) {
    console.warn('[notify->platform] meta fetch error', String(e));
    return null;
  }
}

// --- prende il secret dall'env (più nomi possibili) ---
function getSigningSecret(): string {
  return (
    (process.env.FLAGS_SIGNING_SECRET ?? '').trim() ||
    (process.env.SIGNING_SECRET ?? '').trim() ||
    (process.env.FLAGS_HMAC_SECRET ?? '').trim() ||
    (process.env.FLAGS_SHARED_SECRET ?? '').trim()
  );
}

/* 👇 NUOVO: normalizza la base URL
   - se manca lo schema, mette https://
   - forza http -> https
   - rimuove slash finali
*/
function normalizeBaseUrl(base: string): string {
  let b = (base || '').trim();
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b;       // dominio nudo -> https
  b = b.replace(/^http:\/\//i, 'https://');               // forza https
  b = b.replace(/\/+$/, '');                              // no trailing slash
  return b;
}

// --- SOSTITUISCI LA TUA notifyPlatformRefresh CON QUESTA (stessa logica + https) ---
async function notifyPlatformRefresh(slug: string): Promise<void> {
  const platformBase = await fetchPlatformUrlFromMeta(slug);
  const secret = getSigningSecret();

  if (!platformBase || !secret) {
    console.warn('[notify->platform] missing data', {
      hasPlatform: !!platformBase,
      secretLen: secret.length,
    });
    return;
  }

  // 👇 applico solo la normalizzazione http/https
  const platformBaseNormalized = normalizeBaseUrl(platformBase);
  const url = `${platformBaseNormalized}/api/flags/refresh`;

  const body = JSON.stringify({ slug }); // nessuno spazio extra
  const sig  = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  // log diagnostico (lascia per ora)
  console.warn('[notify->platform]', {
    url,
    slug,
    bodyLen: body.length,
    sigPreview: sig.slice(0, 12),
    secretLen: secret.length,
  });

  await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Signature': sig,
      // opzionale: aiuta il debug lato Laravel
      'Content-Length': Buffer.byteLength(body).toString(),
      'User-Agent': 'flags-server/notify',
    },
    body,
    cache: 'no-store',
  }).then(async r => {
    if (!r.ok) {
      let payload: any = null;
      try { payload = await r.text(); } catch {}
      console.warn('platform refresh not ok:', r.status, payload);
    }
  }).catch(err => {
    console.warn('platform refresh error:', String(err));
  });
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

  // 🔒 SOVRASCRITTURA TOTALE (nessun merge col “current”)
  const saved: FlagsDoc = {
    features: nextFeat,
    updated_at: Date.now(),
    updated_by: req.headers.get('x-actor') ?? undefined,
  };

  await kvSet(keyFlags(slug), saved);
  await upsertInstallation(slug);
  notifyPlatformRefresh(params.slug);

  // history compatta (manteniamo traccia)
  try {
    const hPrev = await kvGet(keyHistory(slug));
    const arr: FlagsDoc[] = safeParse(hPrev) ?? [];
    arr.unshift(saved);
    if (arr.length > MAX_HISTORY) arr.length = MAX_HISTORY;
    await kvSet(keyHistory(slug), arr);
  } catch {}

  return NextResponse.json({ ok:true, slug, saved });
}
