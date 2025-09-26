import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

async function loginAction(formData: FormData) {
  'use server';
  const pass = String(formData.get('password') ?? '');
  const ok = pass && pass === process.env.DASHBOARD_PASSWORD;
  if (!ok) return; // restiamo sulla pagina

  // set cookie (non httpOnly così il render server lo legge tranquillamente)
  cookies().set('fdash', '1', {
    path: '/',
    sameSite: 'lax',
    secure: true,
    maxAge: 60 * 60 * 8, // 8h
  });
  redirect('/flags-dashboard');
}

export default function Login() {
  return (
    <form action={loginAction} style={{maxWidth:420, margin:'60px auto', padding:24, border:'1px solid #e5e7eb', borderRadius:12}}>
      <h1 style={{fontSize:24, fontWeight:800, marginBottom:8}}>Flags Login</h1>
      <p style={{color:'#6b7280', marginBottom:16}}>Inserisci la password del dashboard.</p>
      <input name="password" type="password" placeholder="Dashboard password"
        style={{width:'100%', padding:'10px 12px', border:'1px solid #e5e7eb', borderRadius:10, marginBottom:12}} />
      <button type="submit" style={{padding:'10px 16px', borderRadius:10, background:'#7c3aed', color:'#fff', fontWeight:600}}>
        Login
      </button>
    </form>
  );
}
