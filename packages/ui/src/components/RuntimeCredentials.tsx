/**
 * Each runtime's credential state (VS-75, runtime-credentials/credential-visibility): valid, or an
 * expired login with when the refresh failed and what to run. A valid credential shows no countdown
 * to `expiresAt` (VS-132): that value is a self-refreshing access token's expiry, not a deadline —
 * `lastVerifiedAt` is the evidence a human can act on.
 *
 * The token is never in the data this renders — `UsageCredential` has no field for one — so there
 * is nothing here to redact.
 */
import { runtimeLoginFix } from '@weave-ai/shared';
import type { UsageCredential } from '../api/types';
import { cx } from '../lib/cx';

/** "2026-09-07 09:07 UTC" — absolute, because a human comparing it to their own login needs the clock. */
function at(iso: string | null): string | null {
  return iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : null;
}

function Row({ credential }: { credential: UsageCredential }): React.ReactElement {
  const c = credential;
  return (
    <div data-testid={`credential-${c.runtimeId}`}>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="ac-mono text-meta text-text-1">{c.runtimeId}</span>
        <span
          className={cx(
            'ac-mono text-micro',
            c.needsLogin ? 'text-failed' : !c.present ? 'text-text-3' : 'text-text-soft',
          )}
        >
          {c.needsLogin ? 'login expired' : c.present ? 'valid' : 'no credential'}
        </span>
      </div>
      {c.needsLogin ? (
        <p className="text-micro text-text-3">
          {at(c.refreshFailedAt) ? <>Refresh failed {at(c.refreshFailedAt)}. </> : null}
          Run <code className="ac-mono text-text-soft">{runtimeLoginFix(c.runtimeId).command}</code> on the daemon&rsquo;s host; the work
          resumes on its own.
        </p>
      ) : c.lastVerifiedAt ? (
        <p className="text-nano text-text-4">last verified {at(c.lastVerifiedAt)}</p>
      ) : null}
    </div>
  );
}

export function RuntimeCredentials({
  credentials,
  className,
}: {
  credentials: UsageCredential[];
  className?: string;
}): React.ReactElement | null {
  if (credentials.length === 0) return null;
  return (
    <section className={cx('ac-card p-4', className)} data-testid="runtime-credentials">
      <div className="mb-3.5 text-meta font-medium text-text-soft">Runtime credentials</div>
      <div className="flex flex-col gap-3.5">
        {credentials.map((c) => (
          <Row key={c.runtimeId} credential={c} />
        ))}
      </div>
    </section>
  );
}
