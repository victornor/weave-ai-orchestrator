/**
 * VS-427: the V2 motion pass — the token set, the `.v2-anim-*` classes built on it, the
 * reduced-motion overrides, and the two things JavaScript owns (the decision card's enter/exit class
 * and the `useExitPresence` hold). The web app's vitest config sets `css: false`, so the stylesheet
 * is asserted by reading it, as `v2theme.test.ts` already does.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useExitPresence } from '../v2/motion';

vi.mock('@tanstack/react-router', () => ({ Outlet: () => null, useRouterState: () => '/needs', useParams: () => ({}) }));
vi.mock('../app/link', () => ({
  A: ({ children }: { children?: ReactNode }) => children,
  useGo: () => () => undefined,
}));
vi.mock('../api/hooks', () => ({
  useTicketWorkProducts: () => ({ data: [], isLoading: false }),
  useTicketFor: () => ({ data: undefined, isLoading: false }),
  useTicketDocument: () => ({ data: undefined, isLoading: false, isError: true }),
  useTicketDocumentById: () => ({ data: undefined, isLoading: false, isError: true }),
  useRuns: () => ({ data: [] }),
}));
vi.mock('../api/runStream', () => ({ useRunEventStream: () => ({ events: [], status: { state: 'connected' }, retryNow: vi.fn() }) }));

const { V2DecisionCard } = await import('../v2/DecisionCard');
const { decision } = await import('./factories');

const css = readFileSync(resolve(process.cwd(), 'src/v2/v2.css'), 'utf8');
const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

/** The declaration block that starts at `marker`, up to its next closing brace. */
function blockAt(marker: string): string {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`no block at ${marker}`);
  return css.slice(start, css.indexOf('}', start));
}

function token(block: string, name: string): string | undefined {
  return new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block)?.[1]?.trim();
}

describe('the V2 motion tokens', () => {
  const root = blockAt('.v2-root {\n  /* Dark');

  it('declares the fast/base/slow durations on the V2 root', () => {
    expect(token(root, '--v2-dur-fast')).toBe('120ms');
    expect(token(root, '--v2-dur-base')).toBe('180ms');
    expect(token(root, '--v2-dur-slow')).toBe('240ms');
  });

  it('declares the easing curves', () => {
    for (const name of ['--v2-ease', '--v2-ease-out', '--v2-ease-in-out']) {
      expect(token(root, name)).toMatch(/^cubic-bezier\(/);
    }
  });

  it('every .v2-anim-* class animates on a V2 duration token', () => {
    const classes = [...css.matchAll(/\.v2-anim-[a-z-]+\s*\{\s*animation:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(classes.length).toBeGreaterThanOrEqual(8);
    for (const decl of classes) {
      expect(decl).toMatch(/var\(--v2-dur-[a-z]+\)/);
      expect(decl).toMatch(/var\(--v2-ease[a-z-]*\)/);
    }
  });

  it('turns the animations instant under prefers-reduced-motion', () => {
    const reduced = blockAt('@media (prefers-reduced-motion: reduce)');
    // The block zeroes the V2 durations (the global `index.css` rule is the second, document-wide
    // backstop asserted below).
    expect(reduced).toContain('--v2-dur-fast: 0ms');
    expect(reduced).toContain('--v2-dur-base: 0ms');
    expect(reduced).toContain('--v2-dur-slow: 0ms');
  });

  it('keeps the document-wide reduced-motion override that forces durations to ~0', () => {
    expect(indexCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(indexCss).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(indexCss).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });
});

describe('useExitPresence', () => {
  afterEach(() => vi.useRealTimers());

  it('holds a removed item as exiting for the exit window, then drops it', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ items }: { items: string[] }) => useExitPresence(items, (x) => x, 180), {
      initialProps: { items: ['a', 'b'] },
    });
    expect(result.current).toEqual([
      { item: 'a', exiting: false },
      { item: 'b', exiting: false },
    ]);

    rerender({ items: ['a'] });
    expect(result.current).toEqual([
      { item: 'a', exiting: false },
      { item: 'b', exiting: true },
    ]);

    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toEqual([{ item: 'a', exiting: false }]);
  });

  it('keeps an item that returns before its exit window elapses', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ items }: { items: string[] }) => useExitPresence(items, (x) => x, 180), {
      initialProps: { items: ['a', 'b'] },
    });
    rerender({ items: ['a'] });
    expect(result.current).toContainEqual({ item: 'b', exiting: true });
    rerender({ items: ['a', 'b'] });
    expect(result.current).toEqual([
      { item: 'a', exiting: false },
      { item: 'b', exiting: false },
    ]);
  });
});

describe('the decision card enter/leave classes', () => {
  it('rises in by default and swaps to the exit class when held', () => {
    const d = decision({ id: 'd1', workspaceId: 'alpha', kind: 'question', title: 'Approve now', options: [{ key: 'a', label: 'A' }], inputs: [] });
    const { container, rerender } = render(<V2DecisionCard decision={d} onAnswer={vi.fn()} />);
    expect(container.querySelector('article')?.className).toContain('v2-anim-rise');

    rerender(<V2DecisionCard decision={d} onAnswer={vi.fn()} exiting />);
    expect(container.querySelector('article')?.className).toContain('v2-anim-exit');
  });
});
