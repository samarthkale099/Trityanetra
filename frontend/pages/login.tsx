import { useState, FormEvent } from 'react';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [notice, setNotice] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setNeedsVerify(false);
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) {
        if (data.code === 'EMAIL_NOT_VERIFIED') setNeedsVerify(true);
        setError(data.error || 'Login failed');
        return;
      }
      localStorage.setItem('token', data.token);
      let role = '';
      try { role = JSON.parse(atob(data.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role; } catch { /* fall through to student */ }
      window.location.href =
        role === 'TEACHER' ? '/teacher/ClassroomList' : role === 'ADMIN' ? '/college' : '/student/StudentDashboard';
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-white p-6 rounded shadow space-y-4">
        <h1 className="text-xl font-semibold">Log in</h1>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <input className="w-full border rounded p-2" type="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)} required />
        <input className="w-full border rounded p-2" type="password" placeholder="Password" value={password}
          onChange={(e) => setPassword(e.target.value)} required />
        <button className="w-full bg-blue-600 text-white rounded p-2 disabled:opacity-50" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        {notice && <p className="text-green-700 text-sm">{notice}</p>}
        {needsVerify && (
          <button type="button" className="w-full border border-blue-600 text-blue-600 rounded p-2"
            onClick={async () => {
              setNotice(''); setError('');
              try {
                await fetch('/api/auth/resend-verification', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
                });
                setNotice('If that account is unverified, a new link is on its way.');
              } catch { setError('Could not reach the server'); }
            }}>
            Resend verification email
          </button>
        )}
        <p className="text-sm text-center">
          New student? <Link href="/register" className="text-blue-600">Register</Link>
        </p>
      </form>
    </main>
  );
}
