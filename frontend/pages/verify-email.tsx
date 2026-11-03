import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';

type State = 'verifying' | 'ok' | 'error';

export default function VerifyEmailPage() {
  const router = useRouter();
  const [state, setState] = useState<State>('verifying');
  const [message, setMessage] = useState('Verifying your email…');

  useEffect(() => {
    if (!router.isReady) return;
    const token = typeof router.query.token === 'string' ? router.query.token : '';
    if (!token) {
      setState('error');
      setMessage('This link is missing its verification token.');
      return;
    }
    (async () => {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setState('ok');
          setMessage(data.message || 'Email verified. You can now log in.');
        } else {
          setState('error');
          setMessage(data.error || 'This verification link is invalid or has expired.');
        }
      } catch {
        setState('error');
        setMessage('Could not reach the server. Please try again.');
      }
    })();
  }, [router.isReady, router.query.token]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm bg-white p-6 rounded shadow space-y-3 text-center">
        <h1 className="text-xl font-semibold">Email verification</h1>
        <p className={`text-sm ${state === 'error' ? 'text-red-600' : state === 'ok' ? 'text-green-700' : 'text-gray-600'}`}>
          {message}
        </p>
        {state === 'ok' && <Link href="/login" className="inline-block bg-blue-600 text-white rounded p-2 w-full">Log in</Link>}
        {state === 'error' && <Link href="/login" className="inline-block border border-blue-600 text-blue-600 rounded p-2 w-full">Back to login</Link>}
      </div>
    </main>
  );
}
