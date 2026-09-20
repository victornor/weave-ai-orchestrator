/**
 * The active `.v2-root`'s `data-theme`, for content portalled outside it (VS-367, VS-623).
 *
 * A portal renders into `document.body`, a sibling of `.v2-root`, so V2's theme tokens — keyed on
 * `[data-theme]` — never reach it by inheritance and it silently falls back to `:root` (dark). A
 * portalled surface mirrors the theme onto its own wrapper so its tokens follow the app's choice.
 *
 * `self` excludes the wrapper this hook is mirroring onto: once mirrored it carries `.v2-root` too
 * (Toast), and would otherwise match its own last value forever once the real one unmounts.
 */
import { useEffect, useState } from 'react';

export function useActiveV2RootTheme(self: HTMLElement | null): string | null {
  const find = (): Element | null => [...document.querySelectorAll('.v2-root')].find((el) => el !== self) ?? null;
  const [theme, setTheme] = useState<string | null>(() => find()?.getAttribute('data-theme') ?? null);
  useEffect(() => {
    const read = (): void => setTheme(find()?.getAttribute('data-theme') ?? null);
    const observer = new MutationObserver(read);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme'], childList: true, subtree: true });
    return () => observer.disconnect();
  }, [self]);
  return theme;
}
