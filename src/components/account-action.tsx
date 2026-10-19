'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
export function AccountActionPage({ path }: { path: string }) {
  const params = useSearchParams(),
    router = useRouter(),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const token = params.get('token') ?? '',
    invite = path === '/invite',
    reset = path === '/reset-password',
    forgot = path === '/forgot-password';
  return (
    <main className="legal" id="main-content">
      <Link href="/" className="brand">
        FoodLoop Dispatch
      </Link>
      <h1>
        {invite
          ? 'Join your organization'
          : forgot
            ? 'Recover your account'
            : reset
              ? 'Set a new password'
              : 'Verify your email'}
      </h1>
      <p>
        {invite
          ? 'Sign in using the email address that received this invitation, verify that address, then accept.'
          : forgot
            ? 'Request a time-limited link. The response does not disclose whether an account exists.'
            : reset
              ? 'Choose at least 12 characters, up to 72 UTF-8 bytes. All existing sessions will be revoked.'
              : 'Confirm ownership of the email address used for your account.'}
      </p>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="alert success" role="status">
          {message}
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const f = new FormData(e.currentTarget);
          try {
            const result = await api<{ message?: string }>(
              invite
                ? 'invitations/accept'
                : forgot
                  ? 'auth/forgot-password'
                  : reset
                    ? 'auth/reset-password'
                    : 'auth/verify-email',
              'POST',
              forgot
                ? { email: f.get('email') }
                : reset
                  ? { token, password: f.get('password') }
                  : { token },
            );
            setMessage(result.message ?? 'Invitation accepted.');
            if (invite) router.push('/app/dashboard');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {forgot ? (
          <label className="field">
            Email address
            <input name="email" type="email" required autoComplete="email" />
          </label>
        ) : reset ? (
          <label className="field">
            New password
            <input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={72}
              autoComplete="new-password"
            />
          </label>
        ) : null}
        <button className="button primary" disabled={busy || (!forgot && !token)} type="submit">
          {busy
            ? 'Working…'
            : invite
              ? 'Accept invitation'
              : forgot
                ? 'Request reset link'
                : reset
                  ? 'Update password'
                  : 'Verify email address'}
        </button>
      </form>
      {invite ? (
        <div className="inline">
          <Link href={`/login?next=${encodeURIComponent('/invite?token=' + token)}`}>Sign in</Link>
          <Link href={`/register?next=${encodeURIComponent('/invite?token=' + token)}`}>
            Create account
          </Link>
          <Link href="/app/account">Verify your account</Link>
        </div>
      ) : (
        <p>
          <Link href="/login">Sign in</Link> · <Link href="/app/account">Account security</Link>
        </p>
      )}
      <p className="safety">
        A product of Emerge Nexus · Pakistan. Only follow account links you requested or expected.
      </p>
    </main>
  );
}
