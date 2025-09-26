// app/flags-dashboard/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { listInstallations } from '@/lib/installations';
import { kvGet, kvSet } from '@/lib/kv';
import { verifySignature, signPayload } from '@/lib/sign';

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
        const parsed = JSON.parse(raw);
        if (parsed?.features) flags = parsed;
      }
    }
  } catch {}

  async function saveAction(formData: FormData) {
    'use server';
    const slug = String(formData.get('slug') || '').toLowerCase();
    if (!slug) return;
  
    const payload = {
      features: {
        addons: formData.get('addons') === 'on',
        email_templates: formData.get('email_templates') === 'on',
        discord_integration: formData.get('discord_integration') === 'on',
        tutorials: formData.get('tutorials') === 'on',
        announcements: formData.get('announcements') === 'on',
      }
    };
  
    const raw = JSON.stringify(payload);
    const sig = signPayload(raw); // usa lib/sign.ts che già hai
  
    await fetch(`${process.env.BASE_URL}/api/installations/${slug}/flags`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-signature': sig,
      },
      body: raw,
    });
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
