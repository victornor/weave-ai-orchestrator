/**
 * Each runtime's credential state (VS-75, runtime-credentials/credential-visibility): valid with
 * when it expires, or an expired login with when the refresh failed and what to run.
 *
 * The token is never in the data this renders — `UsageCredential` has no field for one — so there
 * is nothing here to redact.
 */
import type { UsageCredential } from '../api/types';
import { cx } from '../lib/cx';

/** "in 4h" / "in 12m" / "expired" — the same shape the plan-limit resets use. */
function until(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now.getTime();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return 'expired';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `in ${hours}h` : `in ${Math.round(hours / 24)}d`;
}

/** "2026-09-07 09:07 UTC" — absolute, because a human comparing it to their own login needs the clock. */
function at(iso: string | null): string | null {
  return iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : null;
}

function Row({ credential, now }: { credential: UsageCredential; now: Date }): React.ReactElement {
  const c = credential;
  const expiry = until(c.expiresAt, now);
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
        {!c.needsLogin && c.present ? (
          <span className="ac-mono flex-1 text-right text-nano text-text-4">
            {/* A credential with no expiry is a long-lived token, not one about to die. */}
            {c.expiresAt ? `expires ${expiry}` : 'no expiry'}
          </span>
        ) : null}
      </div>
      {c.needsLogin ? (
        <p className="text-micro text-text-3">
          {at(c.refreshFailedAt) ? <>Refresh failed {at(c.refreshFailedAt)}. </> : null}
          Run <code className="ac-mono text-text-soft">{c.runtimeId} /login</code> on the daemon&rsquo;s host; the work
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
  now = new Date(),
  className,
}: {
  credentials: UsageCredential[];
  now?: Date;
  className?: string;
}): React.ReactElement | null {
  if (credentials.length === 0) return null;
  return (
    <section className={cx('ac-card p-4', className)} data-testid="runtime-credentials">
      <div className="mb-3.5 text-meta font-medium text-text-soft">Runtime credentials</div>
      <div className="flex flex-col gap-3.5">
        {credentials.map((c) => (
          <Row key={c.runtimeId} credential={c} now={now} />
        ))}
      </div>
    </section>
  );
}
