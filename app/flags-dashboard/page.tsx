// app/flags-dashboard/page.tsx
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { listInstallations } from '@/lib/installations';
import { kvGet } from '@/lib/kv';
import { signPayload } from '@/lib/sign';

export const dynamic = 'force-dynamic';

/* ============================
   Helpers – hardening
============================ */
function requireAuth() {
  const jar = cookies();
  const ok = jar.get('fdash')?.value === '1';
  if (!ok) redirect('/flags-dashboard/login');
}

function normalizeUrl(u?: string | null): string | undefined {
  if (!u) return undefined;
  return u.replace(/\/+$/,'');
}

function projectOrigin(): string {
  const envBase = process.env.FLAGS_BASE_URL?.replace(/\/+$/,'');
  if (envBase) return envBase;
  const h = headers();
  const proto = h.get('x-forwarded-proto') || 'https';
  const host  = h.get('host') || '';
  return `${proto}://${host}`;
}

function safeParse<T = any>(raw: unknown): T | null {
  try {
    if (typeof raw === 'string') return JSON.parse(raw) as T;
    if (raw && typeof raw === 'object') return raw as T;
    return null;
  } catch {
    if (typeof raw === 'string') {
      try {
        const once = JSON.parse(raw);
        if (typeof once === 'string') return JSON.parse(once) as T;
        if (once && typeof once === 'object') return once as T;
      } catch {}
    }
    return null;
  }
}

async function fetchJsonTolerant(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!res.ok) {
    console.error(`fetchJsonTolerant: ${url} → HTTP ${res.status}`, text.slice(0, 200));
    throw new Error(`HTTP ${res.status}`);
  }
  if (ct.includes('application/json')) {
    try { return JSON.parse(text); } catch {}
  }
  const parsed = safeParse(text);
  return parsed ?? {};
}

/* ============================
   Types
============================ */
type Flags = {
  features: {
    addons: boolean;
    email_templates: boolean;
    discord_integration: boolean;
    tutorials: boolean;
    announcements?: boolean;
  };
};

/* ============================
   Page
============================ */
export default async function FlagsDashboard({
  searchParams,
}: {
  searchParams?: { slug?: string };
}) {
  requireAuth();

  const slugs = await listInstallations();

  // ► usa ?slug=... se presente, altrimenti la prima installazione
  const selectedSlug = (searchParams?.slug || slugs[0] || '').toLowerCase();

  // defaults visivi
  let flags: Flags = {
    features: {
      addons: true,
      email_templates: false,
      discord_integration: false,
      tutorials: false,
      announcements: false,
    },
  };

  // Carica flags correnti per lo slug selezionato
  try {
    if (selectedSlug) {
      const raw = await kvGet(`flags:${selectedSlug}`);
      if (raw) {
        const parsed = safeParse(raw);
        if (parsed?.features && typeof parsed.features === 'object') {
          flags = {
            features: {
              addons:              !!parsed.features.addons,
              email_templates:     !!parsed.features.email_templates,
              discord_integration: !!parsed.features.discord_integration,
              tutorials:           !!parsed.features.tutorials,
              announcements:       !!parsed.features.announcements,
            },
          };
        }
      }
    }
  } catch (e: any) {
    console.warn('flags prefetch warning:', e?.message || e);
  }

  async function saveAction(formData: FormData) {
    'use server';

    const slug = String(formData.get('slug') || '').toLowerCase();
    if (!slug) {
      console.warn('saveAction: slug mancante');
      revalidatePath('/flags-dashboard');
      return;
    }

    const payload: Flags = {
      features: {
        addons:               formData.get('addons') === 'on',
        email_templates:      formData.get('email_templates') === 'on',
        discord_integration:  formData.get('discord_integration') === 'on',
        tutorials:            formData.get('tutorials') === 'on',
        announcements:        formData.get('announcements') === 'on',
      },
    };

    const base = projectOrigin();
    const raw  = JSON.stringify(payload);
    const sig  = signPayload(raw);

    // 1) Scrivi flags sul server "flags"
    try {
      const putRes = await fetch(`${base}/api/installations/${slug}/flags`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-signature': sig,
          'accept': 'application/json',
          'accept-encoding': 'identity',
        },
        cache: 'no-store',
        body: raw,
      });

      if (!putRes.ok) {
        console.error('saveAction error (PUT flags):', putRes.status, await putRes.text());
        revalidatePath('/flags-dashboard?slug=' + encodeURIComponent(slug));
        return;
      }
    } catch (e: any) {
      console.error('saveAction fetch PUT failed:', e?.message || e);
      revalidatePath('/flags-dashboard?slug=' + encodeURIComponent(slug));
      return;
    }

    // 2) Leggi meta e recupera platform_url
    let platformUrl: string | undefined;
    try {
      const meta = await fetchJsonTolerant(`${base}/api/installations/${slug}/meta`);
      const maybe = safeParse<any>(meta) ?? meta;
      const rawUrl =
        typeof maybe === 'string' ? (safeParse<any>(maybe)?.platform_url) :
        maybe?.platform_url;
      platformUrl = normalizeUrl(rawUrl);
    } catch (e: any) {
      console.warn('saveAction meta read failed:', e?.message || e);
    }

    // 3) Notifica la piattaforma per invalidare la cache
    if (platformUrl) {
      const body2 = JSON.stringify({ slug });
      const sig2  = signPayload(body2);
      try {
        const refreshRes = await fetch(`${platformUrl}/api/flags/refresh`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-signature' : sig2,
            'accept': 'application/json',
            'accept-encoding': 'identity',
          },
          cache: 'no-store',
          body: body2,
        });
        if (!refreshRes.ok) {
          console.warn('platform refresh not ok:', refreshRes.status, await refreshRes.text());
        }
      } catch (e: any) {
        console.warn('platform refresh failed:', e?.message || e);
      }
    } else {
      console.warn('No platform_url in meta for', slug);
    }

    // torna sulla stessa installazione
    revalidatePath('/flags-dashboard?slug=' + encodeURIComponent(slug));
  }

  return (
    <>
      {/* Mini form GET per scegliere lo slug e ricaricare la pagina con i flag correnti */}
      <form method="GET" action="/flags-dashboard" className="mb-4 flex items-end gap-3">
        <label className="fd-label">
          Installazione (slug)
          <select name="slug" defaultValue={selectedSlug} className="fd-select">
            <option value="">(non ci sono ancora installazioni)</option>
            {slugs.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <button className="fd-btn" type="submit">Carica</button>
      </form>

      <div className="fd-card">
        <h1>Flags Dashboard</h1>
        <p className="fd-sub">Gestione add-ons installazione Base Forge - Base Builders platform</p>

        {/* Form SAVE (usa lo slug selezionato) */}
        <form action={saveAction} className="flex flex-col gap-4">
          <input type="hidden" name="slug" value={selectedSlug} />

          <div className="fd-grid">
            <label className="ios-switch">
              <input type="checkbox" name="addons" defaultChecked={!!flags.features.addons} />
              <span className="ios-slider" aria-hidden />
              <span className="ios-label">Addons (master)</span>
            </label>

            <label className="ios-switch">
              <input type="checkbox" name="email_templates" defaultChecked={!!flags.features.email_templates} />
              <span className="ios-slider" aria-hidden />
              <span className="ios-label">Email templates</span>
            </label>

            <label className="ios-switch">
              <input type="checkbox" name="discord_integration" defaultChecked={!!flags.features.discord_integration} />
              <span className="ios-slider" aria-hidden />
              <span className="ios-label">Discord integration</span>
            </label>

            <label className="ios-switch">
              <input type="checkbox" name="tutorials" defaultChecked={!!flags.features.tutorials} />
              <span className="ios-slider" aria-hidden />
              <span className="ios-label">Tutorials</span>
            </label>

            <label className="ios-switch">
              <input type="checkbox" name="announcements" defaultChecked={!!flags.features.announcements} />
              <span className="ios-slider" aria-hidden />
              <span className="ios-label">Announcements</span>
            </label>
          </div>

          <button className="fd-btn" type="submit">Save</button>
        </form>
      </div>

      {/* stile “Apple” switch, viola */}
      <style>{`
        .fd-card { border-radius: 16px; padding: 20px; border: 1px solid var(--line, #e5e7eb); background: var(--card, #fff); }
        .fd-sub { color: #6b7280; margin-top: 4px; }
        .fd-label { display: grid; gap: 6px; font-size: 14px; }
        .fd-select {
          appearance: none; padding: 10px 12px; border-radius: 10px; border: 1px solid #e5e7eb;
          background: #fff; min-width: 260px;
        }
        .fd-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
        .fd-btn {
          background: #7c3aed; color: white; padding: 10px 14px; border-radius: 10px; font-weight: 600;
        }
        /* iOS-like switch */
        .ios-switch {
          position: relative; display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 10px;
          padding: 12px; border: 1px solid #e5e7eb; border-radius: 14px; background: #fff;
        }
        .ios-switch input { position: absolute; opacity: 0; pointer-events: none; }
        .ios-slider {
          width: 52px; height: 32px; border-radius: 999px; background: #e5e7eb; position: relative; transition: background .2s ease;
        }
        .ios-slider::after {
          content: ""; position: absolute; top: 3px; left: 3px; width: 26px; height: 26px; border-radius: 50%;
          background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.15); transition: transform .2s ease;
        }
        .ios-switch input:checked + .ios-slider { background: #7c3aed; }
        .ios-switch input:checked + .ios-slider::after { transform: translateX(20px); }
        .ios-label { font-size: 14px; font-weight: 500; color: #111827; }
      `}</style>
    </>
  );
}
