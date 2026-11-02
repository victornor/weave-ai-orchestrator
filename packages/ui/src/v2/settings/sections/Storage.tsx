/**
 * Settings → Workspace → Storage (VS-955): the worker copies the daemon keeps because their work has
 * not landed — size, class, age and why — with the last free-space check, and the reclaim offer.
 *
 * Offering a reclaim raises discard-approval cards in Needs you and removes nothing; a copy holding
 * unpushed or copy-only commits gets a card of its own. The split is shown before anything is sent.
 */
import { useMemo, useState } from 'react';
import { formatBytes } from '@weave-ai/render';
import { RETAINED_COPY_CLASSES, type RetainedCopy, type RetainedCopyClass, type RetainedReclaimOffer } from '@weave-ai/shared';
import { useOfferReclaim, useRetainedCopies, useRetainedScan } from '../../../api/hooks';
import { cx } from '../../../lib/cx';

const CLASS_LABEL: Record<RetainedCopyClass, string> = {
  open: 'ticket open',
  finished_unlanded: 'finished, unlanded',
  branch_gone: 'branch gone',
  orphan: 'orphan',
};

const DAY_MS = 86_400_000;

function age(c: RetainedCopy): string {
  if (!c.ageFrom) return '';
  const days = Math.floor((Date.now() - Date.parse(c.ageFrom)) / DAY_MS);
  return Number.isFinite(days) ? `${days}d` : '';
}

/** `2 modified, 3 untracked · 4 commits not landed (1 unpushed) · branch gone`. */
export function whyKept(c: RetainedCopy): string {
  const parts: string[] = [];
  if (c.reasons.includes('uncommitted') && c.uncommitted) parts.push(`${c.uncommitted.tracked} modified, ${c.uncommitted.untracked} untracked`);
  if (c.reasons.includes('commits_not_on_landing_branch')) {
    const n = Math.max(c.commitsNotOnLandingBranch ?? 0, c.commitsOnlyHere ?? 0);
    parts.push(`${n} ${n === 1 ? 'commit' : 'commits'} not landed${c.commitsOnNoRemote ? ` (${c.commitsOnNoRemote} unpushed)` : ''}`);
  }
  if (c.reasons.includes('branch_gone')) parts.push('branch gone from the clone');
  if (c.reasons.includes('unreadable')) parts.push('state unreadable');
  return parts.join(' · ') || (c.class === 'orphan' ? 'no agent or ticket' : '');
}

function CopyRow({ c, checked, onToggle }: { c: RetainedCopy; checked: boolean; onToggle: () => void }): React.ReactElement {
  const selectable = c.class !== 'open';
  return (
    <label data-retained-copy={c.directory} className={cx('flex items-start gap-3 px-3.5 py-2.5', selectable ? 'cursor-pointer' : 'opacity-70')}>
      <input
        type="checkbox"
        aria-label={`Select ${c.ticketIdentifier ?? c.directory}`}
        className="mt-0.5 size-4 accent-(--accent)"
        checked={checked}
        disabled={!selectable}
        onChange={onToggle}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="ac-mono text-meta text-text-1">{c.ticketIdentifier ?? c.directory}</span>
          {c.ticketStatus ? <span className="text-micro text-text-3">{c.ticketStatus}</span> : null}
          <span className="v2-tag text-text-2">{CLASS_LABEL[c.class]}</span>
          {c.offerable ? <span className="v2-tag text-text-2">offerable</span> : null}
          {c.needsOwnApproval ? <span className="v2-tag text-text-2">own card</span> : null}
        </span>
        <span className="block truncate text-micro text-text-3">{whyKept(c)}</span>
        <span className="ac-mono block truncate text-micro text-text-3">{c.workerName ?? c.directory}{c.branch ? ` · ${c.branch}` : ''}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="ac-mono text-meta text-text-1">{formatBytes(c.bytes)}</span>
        <span className="text-micro text-text-3">{age(c)}</span>
      </span>
    </label>
  );
}

export function StorageSection(): React.ReactElement {
  const report = useRetainedCopies();
  const scan = useRetainedScan();
  const offer = useOfferReclaim();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<RetainedReclaimOffer | null>(null);
  const r = report.data;
  const copies = useMemo(() => r?.copies ?? [], [r]);
  const picked = copies.filter((c) => selected.has(c.directory));
  const own = picked.filter((c) => c.needsOwnApproval);
  const shared = picked.filter((c) => !c.needsOwnApproval);
  const pickedBytes = picked.reduce((n, c) => n + (c.bytes ?? 0), 0);

  const toggle = (dir: string): void => {
    setResult(null);
    setSelected((s) => { const next = new Set(s); if (next.has(dir)) next.delete(dir); else next.add(dir); return next; });
  };
  const selectOfferable = (): void => {
    setResult(null);
    setSelected(new Set(copies.filter((c) => c.offerable).map((c) => c.directory)));
  };
  const send = async (): Promise<void> => {
    const out = await offer.mutateAsync(picked.map((c) => c.directory));
    setResult(out);
    setConfirming(false);
    setSelected(new Set());
  };

  if (report.isLoading) return <p className="text-micro text-text-3">Loading…</p>;
  if (report.isError || !r) return <p className="text-micro text-text-3">Could not load the retained worker copies.</p>;

  const disk = r.disk;
  const diskPct = disk && disk.totalBytes ? Math.round((disk.freeBytes / disk.totalBytes) * 100) : null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-micro leading-relaxed text-text-3">
        Worker copies the daemon keeps because their work has not landed: uncommitted files, or commits not on the landing
        branch. Nothing here is removed on its own. Offering a reclaim raises approval cards in Needs you; an approved
        reclaim removes the copy&apos;s checkout and keeps its branch and commits in the project clone.
      </p>
      {disk ? (
        <div data-disk-check className={cx('v2-card px-3.5 py-2.5 text-micro', disk.low ? 'text-text-1' : 'text-text-3')}>
          {formatBytes(disk.freeBytes)} free of {formatBytes(disk.totalBytes)} ({diskPct}%) on the filesystem holding{' '}
          <span className="ac-mono">{disk.path}</span>{disk.low ? ' — below the warning threshold' : ''}.
        </div>
      ) : null}
      <div className="v2-card flex flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-2.5">
        <span data-retained-total className="text-meta text-text-1">
          {r.totals.count} {r.totals.count === 1 ? 'copy' : 'copies'}, {formatBytes(r.totals.bytes)}
        </span>
        {RETAINED_COPY_CLASSES.filter((k) => r.totals.byClass[k]?.count).map((k) => (
          <span key={k} className="text-micro text-text-3">{CLASS_LABEL[k]}: {r.totals.byClass[k].count} · {formatBytes(r.totals.byClass[k].bytes)}</span>
        ))}
        <span className="text-micro text-text-3">
          {r.scanning ? 'Scanning…' : r.scannedAt ? `Scanned ${new Date(r.scannedAt).toLocaleString()}` : 'Not scanned yet'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="v2-button" disabled={r.scanning || scan.isPending} onClick={() => scan.mutate()}>Rescan</button>
        <button type="button" className="v2-button" disabled={!r.totals.offerable.count} onClick={selectOfferable}>
          Select offerable ({r.totals.offerable.count})
        </button>
        <button type="button" className="v2-button" data-variant="primary" disabled={picked.length === 0} onClick={() => setConfirming(true)}>
          Offer reclaim{picked.length ? ` (${picked.length}, ${formatBytes(pickedBytes)})` : ''}
        </button>
      </div>
      {confirming && picked.length ? (
        <div data-reclaim-confirm className="v2-card flex flex-col gap-2 px-3.5 py-3 text-micro text-text-2">
          <span>
            This raises {own.length + (shared.length ? 1 : 0)} approval {own.length + (shared.length ? 1 : 0) === 1 ? 'card' : 'cards'} and removes nothing:
            {own.length ? ` ${own.length} of their own (unpushed or copy-only commits)` : ''}
            {own.length && shared.length ? ' and' : ''}
            {shared.length ? ` one shared card for ${shared.length} ${shared.length === 1 ? 'copy' : 'copies'}` : ''}.
          </span>
          <span className="flex gap-2">
            <button type="button" className="v2-button" data-variant="primary" disabled={offer.isPending} onClick={() => void send()}>Raise the cards</button>
            <button type="button" className="v2-button" onClick={() => setConfirming(false)}>Cancel</button>
          </span>
        </div>
      ) : null}
      {result ? (
        <div data-reclaim-result className="v2-card px-3.5 py-2.5 text-micro text-text-2">
          {result.cards.length} {result.cards.length === 1 ? 'card' : 'cards'} raised in Needs you; nothing has been removed.
          {result.skipped.map((s) => <span key={s.directory} className="block text-text-3">Not offered {s.directory}: {s.reason}</span>)}
        </div>
      ) : null}
      {copies.length ? (
        <div className="v2-card divide-y divide-line-1">
          {copies.map((c) => <CopyRow key={c.directory} c={c} checked={selected.has(c.directory)} onToggle={() => toggle(c.directory)} />)}
        </div>
      ) : (
        <p className="text-micro text-text-3">{r.scannedAt ? 'No retained worker copies.' : 'No scan has run yet. Rescan to measure them.'}</p>
      )}
    </div>
  );
}
