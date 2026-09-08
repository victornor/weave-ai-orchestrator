import { Badge } from './StatusGlyph';
import { Button } from './Button';
import type { CommitStatusValue } from '../lib/commit-field';

/**
 * The visible half of a committable field (VS-141): nothing while clean, "Unsaved"/"Save" while
 * dirty, "Saving…" mid-flight, a transient "Saved" once it resolves, or the rejection's message with
 * a retry once it doesn't. This is what makes a save's outcome answerable without reloading.
 */
export function CommitStatus({ status, error, onSave }: { status: CommitStatusValue; error?: string; onSave: () => void }): React.ReactElement | null {
  if (status === 'idle') return null;
  if (status === 'saving') return <Badge tone="modified">Saving…</Badge>;
  if (status === 'saved') return <Badge tone="added">Saved</Badge>;
  if (status === 'error') {
    // Plain text, not a pill: a validation message is a sentence, not a short label, and the
    // uppercase Badge treatment wraps a full sentence into an unreadable column in a narrow row
    // (a project's inline landing-branch field, phone-width) — found only by checking a real
    // browser's layout, which jsdom's text-presence assertions cannot catch.
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="min-w-0 text-micro text-failed">{error ?? 'Could not save'}</span>
        <Button variant="link" size="sm" onClick={onSave}>
          Retry
        </Button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <Badge tone="modified">Unsaved</Badge>
      <Button variant="link" size="sm" onClick={onSave}>
        Save
      </Button>
    </span>
  );
}
