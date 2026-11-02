import { useState, FormEvent } from 'react';
import Link from 'next/link';

// Only STUDENT accounts can self-register. Teachers/admins are assigned by an admin.
export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [collegeId, setCollegeId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role: 'STUDENT', ...(collegeId.trim() ? { collegeId: collegeId.trim() } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Registration failed');
        return;
      }
      window.location.href = '/login';
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-white p-6 rounded shadow space-y-4">
        <h1 className="text-xl font-semibold">Student registration</h1>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <input className="w-full border rounded p-2" type="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)} required />
        <input className="w-full border rounded p-2" type="password" placeholder="Password" value={password}
          onChange={(e) => setPassword(e.target.value)} required />
        <input className="w-full border rounded p-2" placeholder="College ID (optional)" value={collegeId}
          onChange={(e) => setCollegeId(e.target.value)} />
        <p className="text-xs text-gray-500">
          Use your college email and you are placed in your college automatically. Only fill in the college ID if your
          email is not on your college's domain.
        </p>
        <button className="w-full bg-blue-600 text-white rounded p-2 disabled:opacity-50" disabled={busy}>
          {busy ? 'Registering…' : 'Register'}
        </button>
        <p className="text-sm text-center">
          Already registered? <Link href="/login" className="text-blue-600">Log in</Link>
        </p>
      </form>
    </main>
  );
}
