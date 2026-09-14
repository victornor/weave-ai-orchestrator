/**
 * The composer's dictation hint. The chord is meta+shift+Space on macOS and ctrl+shift+Space
 * everywhere else, it acts as both a toggle (quick press) and push-to-talk (a held press), and a
 * touch device has no chord at all, so the hint has to name the input it actually accepts
 * (VS-432). Pure and userAgent-injected so the platform branches are testable without a real
 * navigator.
 */

/** The platform-appropriate chord label, e.g. `⌘⇧Space` on a Mac and `Ctrl+Shift+Space` elsewhere. */
export function dictationShortcut(userAgent?: string): string {
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return /Mac|iPhone|iPad|iPod/.test(ua) ? '⌘⇧Space' : 'Ctrl+Shift+Space';
}

export function dictationHint(opts: { isTouch: boolean; userAgent?: string }): string {
  if (opts.isTouch) return 'tap the mic to dictate';
  return `${dictationShortcut(opts.userAgent)} to dictate · hold to talk`;
}
