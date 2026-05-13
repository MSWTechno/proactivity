'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function LoginCard() {
  const params = useSearchParams();
  const error = params.get('error');
  return (
    <>
      <h1 className="wordmark" style={{ marginBottom: 20 }}>
        <span className="dot" aria-hidden="true" />proactivity{' '}
        <span style={{ color: 'var(--fg-muted)', fontWeight: 400, fontSize: 18 }}>admin</span>
      </h1>
      <p className="onboarding-sub" style={{ marginBottom: 20 }}>
        Sign in with your Google account. Only allowlisted addresses can access the dashboard.
      </p>
      {error && <p className="rating-error">{error}</p>}
      <a href="/api/admin/auth/google" className="btn-primary admin-google-btn">
        <GoogleG /> Sign in with Google
      </a>
    </>
  );
}

export default function AdminLoginPage() {
  return (
    <main className="admin-login">
      <Suspense fallback={<p>Loading…</p>}>
        <LoginCard />
      </Suspense>
    </main>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ marginRight: 8, verticalAlign: 'text-bottom' }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"/>
    </svg>
  );
}
