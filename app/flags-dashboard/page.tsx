Funzionante   // app/flags-dashboard/page.tsx
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
  // Preferisci env su Vercel
  const envBase = process.env.FLAGS_BASE_URL?.replace(/\/+$/,'');
  if (envBase) return envBase;

  // Fallback: proto + host dagli headers
  const h = headers();
  const proto = h.get('x-forwarded-proto') || 'https';
  const host  = h.get('host') || '';
  return `${proto}://${host}`;
}

/** Prova a fare JSON.parse.
 *  Se fallisce ma la stringa sembra doppiamente stringificata,
 *  riprova a togliere un layer e parse-are di nuovo.
 */
function safeParse<T = any>(raw: unknown): T | null {
  try {
    if (typeof raw === 'string') {
      // primo tentativo
      return JSON.parse(raw) as T;
    }
    if (raw && typeof raw === 'object') {
      return raw as T;
    }
    return null;
  } catch {
    // raw è una stringa con JSON escapato? (\"...\" e backslash a pioggia)
    if (typeof raw === 'string') {
      try {
        const once = JSON.parse(raw);    // toglie 1 layer
        if (typeof once === 'string') {
          // era stringa di JSON → prova ancora
          return JSON.parse(once) as T;
        }
        if (once && typeof once === 'object') {
          return once as T;
        }
      } catch { /* ignore */ }
    }
    return null;
  }
}

/** Recupera JSON con tolleranza su content-type e blob di testo */
async function fetchJsonTolerant(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!res.ok) {
    console.error(`fetchJsonTolerant: ${url} → HTTP ${res.status}`, text.slice(0, 200));
    throw new Error(`HTTP ${res.status}`);
  }
  if (ct.includes('application/json')) {
    try { return JSON.parse(text); } catch { /* cade sotto */ }
  }
  // tenta parse “tollerante” anche se non JSON
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
export default async function FlagsDashboard() {
  requireAuth();

  const slugs = await listInstallations();
  const defaultSlug = slugs[0] ?? '';

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

  // Carica flags correnti (tollerante a valori “escapati”)
  try {
    if (defaultSlug) {
      const raw = await kvGet(`flags:${defaultSlug}`);
      if (raw) {
        const parsed = safeParse(raw);
        if (parsed?.features && typeof parsed.features === 'object') {
          // prendi SOLO i campi noti per sicurezza
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
        revalidatePath('/flags-dashboard');
        return;
      }
    } catch (e: any) {
      console.error('saveAction fetch PUT failed:', e?.message || e);
      revalidatePath('/flags-dashboard');
      return;
    }

    // 2) Leggi meta e recupera platform_url (tollerante agli “escape”)
    let platformUrl: string | undefined;
    try {
      const meta = await fetchJsonTolerant(`${base}/api/installations/${slug}/meta`);
      // meta può essere: { platform_url: "..." } oppure stringa-JSON annidata
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

    revalidatePath('/flags-dashboard');
  }

  return (
    <>
      <div className="fd-card ">
        <h1>Flags Dashboard</h1>
        <p className="fd-sub">Gestione add-ons installazione Base Forge - Base Builders platform</p>

        <form action={saveAction} className='flex flex-col gap-4'>
          <label className="fd-label">
            Installazione (slug)
            <select name="slug" defaultValue={defaultSlug} className="fd-select">
              <option value="">(non ci sono ancora installazioni)</option>
              {slugs.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>

          <div className="fd-grid">
            <label className="fd-switch">
              <input type="checkbox" name="addons" defaultChecked={!!flags.features.addons} />
              <span className="fd-slider" aria-hidden />
              <span className="fd-switch-label">Addons (master)</span>
            </label>

            <label className="fd-switch">
              <input type="checkbox" name="email_templates" defaultChecked={!!flags.features.email_templates} />
              <span className="fd-slider" aria-hidden />
              <span className="fd-switch-label">Email templates</span>
            </label>

            <label className="fd-switch">
              <input type="checkbox" name="discord_integration" defaultChecked={!!flags.features.discord_integration} />
              <span className="fd-slider" aria-hidden />
              <span className="fd-switch-label">Discord integration</span>
            </label>

            <label className="fd-switch">
              <input type="checkbox" name="tutorials" defaultChecked={!!flags.features.tutorials} />
              <span className="fd-slider" aria-hidden />
              <span className="fd-switch-label">Tutorials</span>
            </label>

            <label className="fd-switch">
              <input type="checkbox" name="announcements" defaultChecked={!!flags.features.announcements} />
              <span className="fd-slider" aria-hidden />
              <span className="fd-switch-label">Announcements</span>
            </label>
          </div>

          <button className="fd-btn" type="submit">Save</button>
        </form>
      </div>
    </>
  );
}

