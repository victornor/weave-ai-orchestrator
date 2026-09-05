import { cx } from '../lib/cx';

function DownIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
      <path d="M8 2.6v10.2M3.4 8.4 8 13l4.6-4.6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Shown over a message list the human has scrolled up from: pressing it returns to the newest
 * message and resumes the follow. The dot says content arrived while they were away from the bottom.
 */
export function ScrollToBottomButton({
  unread,
  onClick,
  className,
}: {
  unread?: boolean;
  onClick: () => void;
  className?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={unread ? 'Scroll to bottom — new messages' : 'Scroll to bottom'}
      onClick={onClick}
      className={cx(
        'absolute bottom-3 left-1/2 z-10 inline-flex size-9 -translate-x-1/2 items-center justify-center rounded-pill border border-line-2 bg-bg-1 text-text-2 shadow-float transition-colors duration-(--dur-fast) ease-ac hover:bg-bg-3 hover:text-text-1',
        className,
      )}
    >
      <DownIcon />
      {unread ? <span aria-hidden className="absolute right-0 top-0 size-2.5 rounded-pill border-2 border-bg-1 bg-accent" /> : null}
    </button>
  );
}
