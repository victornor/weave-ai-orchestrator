import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, NetworkError, api, setToken, setWorkspaceId } from '../api/client';
import type { Health, LoginResponse } from '../api/types';
import { useHealth, useMe } from '../api/hooks';
import { qk } from '../api/keys';
import { Button } from '../components/Button';
import { TOTPInput } from '../components/TOTPInput';
import { UnreachableScreen } from '../components/ConnectionBanner';
import { Skeleton } from '../components/Skeleton';
import { useGo } from '../app/link';
import { cx } from '../lib/cx';

type Stage = 'password' | 'totp' | 'setup';

interface TypedError {
  code: string;
  title: string;
  detail: string;
}

function typedError(e: unknown): TypedError {
  if (e instanceof NetworkError) {
    return { code: 'NET_DAEMON_UNREACHABLE', title: 'Cannot reach the daemon.', detail: 'The server did not respond. Check it is running, then retry.' };
  }
  if (e instanceof ApiError) {
    const d = (e.details ?? {}) as { attemptsLeft?: number; retryAfterSeconds?: number };
    const code = e.code.toUpperCase();
    if (code.includes('LOCK')) {
      return { code: 'AUTH_LOCKED', title: 'Account locked.', detail: 'Five failed attempts. The lock clears on its own; nothing to do but wait.' };
    }
    if (code.includes('EXPIRED')) {
      return { code: 'AUTH_SESSION_EXPIRED', title: 'Session expired.', detail: 'You were signed out. Your queued messages are still here.' };
    }
    if (code.includes('CREDENTIAL') || e.status === 401) {
      return {
        code: 'AUTH_BAD_CREDENTIALS',
        title: 'Wrong password.',
        detail: d.attemptsLeft != null ? `${d.attemptsLeft} attempts left before this account locks for 15 minutes.` : 'Check the password and try again.',
      };
    }
    return { code, title: e.message, detail: 'See the daemon log for detail.' };
  }
  return { code: 'UNKNOWN_ERROR', title: 'Sign-in failed.', detail: 'Try again.' };
}

function lockSeconds(e: unknown): number | null {
  if (e instanceof ApiError) {
    const d = (e.details ?? {}) as { retryAfterSeconds?: number };
    if (typeof d.retryAfterSeconds === 'number') return d.retryAfterSeconds;
  }
  return null;
}

/** `?next=/w/…` set by the 401 redirect: return there after sign-in. Only in-app paths are honoured. */
function nextPath(): string | null {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/w/') ? next : null;
}

export function LoginRoute(): React.ReactElement {
  const health = useHealth();
  const me = useMe();
  const qc = useQueryClient();
  const go = useGo();
  const [stage, setStage] = useState<Stage>('password');
  const [username, setUsername] = useState('operator');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [totp, setTotp] = useState('');
  const [remember, setRemember] = useState(true);
  const [deviceName, setDeviceName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TypedError | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (health.data && !health.data.operatorConfigured) setStage('setup');
  }, [health.data]);

  // An existing session lands straight on Needs you.
  useEffect(() => {
    const first = health.data?.workspaces?.[0]?.id;
    if (me.isSuccess && first) {
      setWorkspaceId(first);
      go(nextPath() ?? `/w/${first}/needs`, { replace: true });
    }
  }, [me.isSuccess, health.data, go]);

  useEffect(() => {
    if (countdown == null || countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => (c == null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && !deviceName) {
      const ua = navigator.userAgent;
      const guess = /iPhone|Android/.test(ua) ? 'Phone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'PC' : 'Browser';
      setDeviceName(`${guess} · ${new Date().toLocaleDateString()}`);
    }
  }, [deviceName]);

  // NET_DAEMON_UNREACHABLE is full-screen at load only.
  if (health.isError && health.error instanceof NetworkError) {
    return <UnreachableScreen host={window.location.host} onRetry={() => void health.refetch()} />;
  }

  const landAfterLogin = (h: Health | undefined): void => {
    const ws = h?.workspaces?.[0]?.id;
    if (ws) {
      setWorkspaceId(ws);
      go(nextPath() ?? `/w/${ws}/needs`, { replace: true });
    } else {
      go('/', { replace: true });
    }
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (stage === 'setup') {
        if (password.length < 8 || password !== confirm) {
          setError({ code: 'AUTH_WEAK_PASSWORD', title: 'Passwords must match and be at least 8 characters.', detail: 'This password protects everything the daemon can do.' });
          return;
        }
        await api.root('/auth/setup', { method: 'POST', body: { username, password } });
      }
      const res = await api.root<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { username, password, kind: 'web', ...(totp ? { totp } : {}), ...(remember ? { deviceName } : {}) },
      });
      if (res.totpRequired) {
        setStage('totp');
        return;
      }
      if (res.token) setToken(res.token, remember);
      await qc.invalidateQueries({ queryKey: qk.me() });
      const h = await qc.fetchQuery({ queryKey: qk.health(), queryFn: () => api.root<Health>('/health') });
      landAfterLogin(h);
    } catch (e) {
      if (e instanceof ApiError && e.code.toLowerCase().includes('totp')) {
        setStage('totp');
        setError(null);
        return;
      }
      const t = typedError(e);
      setError(t);
      const secs = lockSeconds(e);
      if (t.code === 'AUTH_LOCKED') setCountdown(secs ?? 900);
    } finally {
      setBusy(false);
    }
  };

  const locked = countdown != null && countdown > 0;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg-0 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-r6 bg-accent">
            <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
              <path d="M6 0.3 L11.7 6 L6 11.7 L0.3 6 Z" fill="var(--accent-on)" />
            </svg>
          </span>
          <h1 className="text-title font-semibold tracking-title text-text-strong">AgentConductor</h1>
        </div>

        {health.isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-9 w-full rounded-r6" />
            <Skeleton className="h-9 w-full rounded-r6" />
            <Skeleton className="h-9 w-full rounded-r6" />
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!locked) void submit();
            }}
          >
            {stage === 'setup' ? (
              <p className="mb-1 text-meta leading-relaxed text-text-2">
                First run: set the operator password. The daemon will not accept a non-loopback connection without one.
              </p>
            ) : null}

            {stage !== 'totp' ? (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className="ac-label">Username</span>
                  <input
                    value={username}
                    autoComplete="username"
                    onChange={(e) => setUsername(e.target.value)}
                    className="h-9 rounded-r6 border border-line-2 bg-bg-input px-3 text-body text-text-1 outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="ac-label">Password</span>
                  <input
                    type="password"
                    value={password}
                    autoFocus
                    autoComplete={stage === 'setup' ? 'new-password' : 'current-password'}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-9 rounded-r6 border border-line-2 bg-bg-input px-3 text-body text-text-1 outline-none"
                  />
                </label>
                {stage === 'setup' ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="ac-label">Confirm password</span>
                    <input
                      type="password"
                      value={confirm}
                      autoComplete="new-password"
                      onChange={(e) => setConfirm(e.target.value)}
                      className="h-9 rounded-r6 border border-line-2 bg-bg-input px-3 text-body text-text-1 outline-none"
                    />
                  </label>
                ) : null}
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <span className="ac-label">Authentication code</span>
                <TOTPInput value={totp} onChange={setTotp} onComplete={() => void submit()} invalid={error?.code === 'AUTH_BAD_CREDENTIALS'} />
                <p className="text-micro text-text-3">Six digits from your authenticator, or a recovery code.</p>
              </div>
            )}

            {stage !== 'setup' ? (
              <label className="flex items-center gap-2.5 py-1">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-3.5 accent-(--accent)" />
                <span className="text-meta text-text-2">Remember this device</span>
                {remember ? (
                  <input
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    aria-label="Device name"
                    className="ac-mono ml-auto h-7 w-40 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro text-text-2 outline-none"
                  />
                ) : null}
              </label>
            ) : null}

            {error ? (
              <div className={cx('rounded-r6 border p-3', error.code === 'AUTH_LOCKED' ? 'border-blocked/35 bg-blocked/8' : 'border-failed/30 bg-failed/8')} role="alert">
                <div className="ac-mono mb-1 text-micro text-failed">{error.code}</div>
                <div className="text-meta font-medium text-text-1">
                  {error.code === 'AUTH_LOCKED' && locked
                    ? `Locked for ${Math.floor((countdown ?? 0) / 60)}:${String((countdown ?? 0) % 60).padStart(2, '0')}.`
                    : error.title}
                </div>
                <div className="mt-1 text-micro leading-relaxed text-text-2">{error.detail}</div>
              </div>
            ) : null}

            <Button type="submit" variant="primary" size="thumb" full disabled={busy || locked}>
              {stage === 'setup' ? 'Set password and sign in' : stage === 'totp' ? 'Verify' : 'Sign in'}
            </Button>
          </form>
        )}

        <p className="mt-5 text-micro leading-relaxed text-text-4">
          {health.data ? `v${health.data.version} · ${health.data.tlsMode}` : ''}
        </p>
      </div>
    </div>
  );
}
