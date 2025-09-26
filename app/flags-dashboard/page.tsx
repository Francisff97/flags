// app/flags-dashboard/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { listInstallations } from '@/lib/installations';
import { kvGet, kvSet } from '@/lib/kv';
import { verifySignature, signPayload } from '@/lib/sign';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

function requireAuth() {
  const jar = cookies();
  const ok = jar.get('fdash')?.value === '1';
  if (!ok) redirect('/flags-dashboard/login');
}

type Flags = {
  features: {
    addons: boolean;
    email_templates: boolean;
    discord_integration: boolean;
    tutorials: boolean;
    announcements?: boolean;
  };
};

export default async function FlagsDashboard() {
  requireAuth();

  const slugs = await listInstallations();
  const defaultSlug = slugs[0] ?? '';

  let flags: Flags = {
    features: {
      addons: true,
      email_templates: false,
      discord_integration: false,
      tutorials: false,
      announcements: false,
    },
  };

  try {
    if (defaultSlug) {
      const raw = await kvGet(`flags:${defaultSlug}`);
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed?.features) flags = parsed as Flags;
      }
    }
  } catch {}

  function flagsOrigin() {
    // 1) usa env se presente (consigliato su Vercel)
    if (process.env.FLAGS_BASE_URL) return process.env.FLAGS_BASE_URL.replace(/\/+$/,'');
    // 2) ricava da headers (x-forwarded-proto + host)
    const h = headers();
    const proto = h.get('x-forwarded-proto') || 'https';
    const host  = h.get('host') || '';
    return `${proto}://${host}`;
  }
  
  async function saveAction(formData: FormData) {
    'use server';
  
    const slug = String(formData.get('slug') || '').toLowerCase();
    if (!slug) return;
  
    const payload = {
      features: {
        addons:               formData.get('addons') === 'on',
        email_templates:      formData.get('email_templates') === 'on',
        discord_integration:  formData.get('discord_integration') === 'on',
        tutorials:            formData.get('tutorials') === 'on',
        announcements:        formData.get('announcements') === 'on',
      },
    };
  
    const raw = JSON.stringify(payload);
    const sig = signPayload(raw);
  
    // Costruisci ORIGIN assoluto per chiamare l'API del progetto "flags"
    const h = headers();
    const base =
      (process.env.FLAGS_BASE_URL?.replace(/\/+$/,''))
      || `${(h.get('x-forwarded-proto') || 'https')}://${(h.get('host') || '').replace(/\/+$/,'')}`;
  
    // 1) Salva i flag su Flags
    const putRes = await fetch(`${base}/api/installations/${slug}/flags`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-signature': sig,
      },
      cache: 'no-store',
      body: raw,
    });
  
    if (!putRes.ok) {
      console.error('saveAction error (PUT flags):', putRes.status, await putRes.text());
      return;
    }
  
    // 2) Recupera la platform_url dal meta
    const metaRes = await fetch(`${base}/api/installations/${slug}/meta`, { cache: 'no-store' });
    if (!metaRes.ok) {
      console.error('saveAction error (GET meta):', metaRes.status, await metaRes.text());
      revalidatePath('/flags-dashboard');
      return;
    }
    const meta = await metaRes.json().catch(() => null);
    const platformUrl = meta?.platform_url?.replace(/\/+$/,'');
    if (platformUrl) {
      // 3) Notifica la piattaforma per invalidare la cache flags locale
      const body2 = JSON.stringify({ slug });
      const sig2  = signPayload(body2);
  
      try {
        const refreshRes = await fetch(`${platformUrl}/api/flags/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-signature': sig2 },
          body: body2,
          cache: 'no-store',
        });
        if (!refreshRes.ok) {
          console.warn('platform refresh not ok:', refreshRes.status, await refreshRes.text());
        }
      } catch (e:any) {
        console.warn('platform refresh failed:', e.message);
      }
    } else {
      console.warn('No platform_url in meta for', slug);
    }
  
    revalidatePath('/flags-dashboard');
  }
  

  return (
    <>
      <div className="fd-card">
        <h1>Flags Dashboard</h1>
        <p className="fd-sub">Manage feature flags per installation.</p>

        <form action={saveAction}>
          <label className="fd-label">
            Installation (slug)
            <select name="slug" defaultValue={defaultSlug} className="fd-select">
              <option value="">(no installations yet)</option>
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
