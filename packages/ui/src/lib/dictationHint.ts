/**
 * The composer's dictation hint. The chord is meta+shift+M on macOS and ctrl+shift+M everywhere
 * else, it is push-to-talk at a desk (hold to talk, release to stop), and a touch device has no
 * chord at all, so the hint has to name the input it actually accepts (VS-416). Pure and
 * userAgent-injected so the platform branches are testable without a real navigator.
 */
export function dictationHint(opts: { isTouch: boolean; userAgent?: string }): string {
  if (opts.isTouch) return 'tap the mic to dictate';
  const ua = opts.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return /Mac|iPhone|iPad|iPod/.test(ua) ? 'hold ⌘⇧M to dictate' : 'hold Ctrl+Shift+M to dictate';
}
