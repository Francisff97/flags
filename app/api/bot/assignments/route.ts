import { NextResponse } from 'next/server';
import { listInstallations } from '@/lib/installations';
import { kvGet } from '@/lib/kv';

const BOT_TOKEN = process.env.FLAGS_BOT_TOKEN || '';
const keyFlags = (slug: string) => `flags:${slug}`;
const keyMeta  = (slug: string) => `installation:${slug}:meta`;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token') || '';
  if (!BOT_TOKEN || token !== BOT_TOKEN) {
    return NextResponse.json({ ok:false, error:'unauthorized' }, { status: 401 });
  }

  const slugs = await listInstallations();
  const items: Array<{slug:string; platform_url:string; discord_enabled:boolean}> = [];

  for (const slug of slugs) {
    try {
      const flagsRaw = await kvGet(keyFlags(slug));
      const metaRaw  = await kvGet(keyMeta(slug));
      const flags = flagsRaw ? JSON.parse(flagsRaw) : {};
      const meta  = metaRaw  ? JSON.parse(metaRaw)  : {};
      const discordEnabled = !!flags?.features?.discord_integration;
      const platformUrl    = typeof meta?.platform_url === 'string' ? meta.platform_url : '';

      if (discordEnabled && platformUrl) {
        items.push({ slug, platform_url: platformUrl, discord_enabled: true });
      }
    } catch { /* skip */ }
  }

  return NextResponse.json({ ok: true, items });
}
