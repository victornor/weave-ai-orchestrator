/**
 * V2 sign-in (VS-353, mockup 17-login). Chromeless — it renders inside the V2 token root but not the
 * shell — and reuses V1's authentication: first-run set-password, password, the TOTP second step,
 * the remembered device, and the daemon's error and lockout states. The only V2 decisions are the
 * Mono presentation and returning to the `/ address the visitor came from.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, NetworkError, api, setToken, setWorkspaceId } from '../api/client';
import type { Health, LoginResponse } from '../api/types';
import { useHealth, useMe } from '../api/hooks';
import { qk } from '../api/keys';
import { Button } from '../components/Button';
import { TOTPInput } from '../components/TOTPInput';
import { WeaveMark } from '../components/WeaveMark';
import { UnreachableScreen } from '../components/ConnectionBanner';
import { Skeleton } from '../components/Skeleton';
import { useGo } from '../app/link';
import { cx } from '../lib/cx';
import { v2Landing, resetV2RefusedCache } from './auth';

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
      return { code: 'AUTH_SESSION_EXPIRED', title: 'Session expired.', detail: 'You were signed out. Sign in again to continue.' };
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

const INPUT = 'h-9 w-full rounded-r6 border border-line-2 bg-bg-input px-3 text-body text-text-1 outline-none focus:border-accent';

export function V2Login(): React.ReactElement {
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

  // A browser the daemon already accepts — including a trusted loopback principal, whose session is
  // null — lands straight on its target; only a refused request reaches this page at all.
  useEffect(() => {
    if (!me.isSuccess || !health.data) return;
    const first = health.data.workspaces?.[0]?.id ?? null;
    if (first) setWorkspaceId(first);
    // The guard may have cached a refusal moments ago; the daemon now accepts us.
    resetV2RefusedCache();
    go(v2Landing(first), { replace: true });
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

  if (health.isError && health.error instanceof NetworkError) {
    return <UnreachableScreen host={window.location.host} onRetry={() => void health.refetch()} />;
  }

  const land = (h: Health | undefined): void => {
    const ws = h?.workspaces?.[0]?.id ?? null;
    if (ws) setWorkspaceId(ws);
    // Forget the guard's cached refusal before navigating, or the landing hits the same guard and
    // bounces straight back to `/login` (a remembered device or a quick TOTP finishes well inside
    // the probe's cache window).
    resetV2RefusedCache();
    go(v2Landing(ws), { replace: true });
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
      // The token is set: drop any cached "refused" so the landing navigation passes the guard.
      resetV2RefusedCache();
      await qc.invalidateQueries({ queryKey: qk.me() });
      const h = await qc.fetchQuery({ queryKey: qk.health(), queryFn: () => api.root<Health>('/health') });
      land(h);
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
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-[320px]">
        <div className="mb-6 flex items-center gap-2.5 text-text-strong">
          <WeaveMark className="h-[22px] w-auto" title="Weave" />
        </div>

        {health.isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-9 w-full rounded-r6" />
            <Skeleton className="h-9 w-full rounded-r6" />
            <Skeleton className="h-9 w-full rounded-r6" />
          </div>
        ) : (
          <form
            className="flex flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              if (!locked) void submit();
            }}
          >
            {stage === 'totp' ? (
              <>
                <h1 className="mb-1 text-title font-semibold tracking-[-0.015em] text-text-strong">Enter your code</h1>
                <p className="mb-5 text-ui text-text-2">Six digits from your authenticator.</p>
                <div className="mb-4">
                  <TOTPInput value={totp} onChange={setTotp} onComplete={() => void submit()} invalid={error?.code === 'AUTH_BAD_CREDENTIALS'} />
                </div>
              </>
            ) : (
              <>
                <h1 className="mb-1 text-title font-semibold tracking-[-0.015em] text-text-strong">
                  {stage === 'setup' ? 'Set your password' : 'Sign in'}
                </h1>
                <p className="mb-5 text-ui text-text-2">
                  {stage === 'setup' ? 'First run: this password protects everything the daemon can do.' : 'Welcome back.'}
                </p>
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="ac-label">Username</span>
                    <input value={username} autoComplete="username" onChange={(e) => setUsername(e.target.value)} className={INPUT} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="ac-label">Password</span>
                    <input
                      type="password"
                      value={password}
                      autoFocus
                      autoComplete={stage === 'setup' ? 'new-password' : 'current-password'}
                      onChange={(e) => setPassword(e.target.value)}
                      className={INPUT}
                    />
                  </label>
                  {stage === 'setup' ? (
                    <label className="flex flex-col gap-1.5">
                      <span className="ac-label">Confirm password</span>
                      <input type="password" value={confirm} autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} className={INPUT} />
                    </label>
                  ) : null}
                </div>
              </>
            )}

            {stage !== 'setup' ? (
              <label className="my-4 flex items-center gap-2.5">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 rounded-[3px] accent-(--accent)" />
                <span className="text-ui text-text-2">
                  Remember this device{remember && deviceName ? <> — <span className="text-text-1">{deviceName}</span></> : null}
                </span>
              </label>
            ) : null}

            {error ? (
              <div className={cx('mb-4 rounded-r6 border p-3', error.code === 'AUTH_LOCKED' ? 'border-blocked/35 bg-blocked/8' : 'border-failed/30 bg-failed/8')} role="alert">
                <div className="ac-mono mb-1 text-nano text-failed">{error.code}</div>
                <div className="text-ui font-medium text-text-1">
                  {error.code === 'AUTH_LOCKED' && locked
                    ? `Locked for ${Math.floor((countdown ?? 0) / 60)}:${String((countdown ?? 0) % 60).padStart(2, '0')}.`
                    : error.title}
                </div>
                <div className="mt-1 text-micro leading-relaxed text-text-2">{error.detail}</div>
              </div>
            ) : null}

            <Button type="submit" variant="primary" size="thumb" full disabled={busy || locked} className="h-11 rounded-r6">
              {stage === 'setup' ? 'Set password and sign in' : stage === 'totp' ? 'Continue' : 'Sign in'}
            </Button>
          </form>
        )}

        <p className="mt-3.5 text-center ac-mono text-micro text-text-2">
          {window.location.host} · weave-ai
        </p>
      </div>
    </div>
  );
}
