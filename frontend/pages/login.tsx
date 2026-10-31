import { useState, FormEvent } from 'react';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) {
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
        <p className="text-sm text-center">
          New student? <Link href="/register" className="text-blue-600">Register</Link>
        </p>
      </form>
    </main>
  );
}
