/** VS-615: the live UI reads a runtime's `capabilities.partialOutput` from the daemon, not a table of runtime ids. */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  runtimes: [
    { id: 'claude', displayName: 'Claude', capabilities: { partialOutput: 'full' } },
    { id: 'cursor', displayName: 'Cursor', capabilities: { partialOutput: 'text' } },
    { id: 'brand-new', displayName: 'New', capabilities: { partialOutput: 'full' } },
    { id: 'silent', displayName: 'Silent', capabilities: {} },
  ],
}));
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: { root: async () => state.runtimes },
}));

const { usePartialOutput } = await import('../api/hooks');

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('usePartialOutput', () => {
  it.each([['claude', 'full'], ['cursor', 'text'], ['brand-new', 'full'], ['silent', 'none'], ['not-registered', 'none'], [null, 'none']] as const)('%s reads as %s', async (runtimeId, expected) => {
    const { result } = renderHook(() => usePartialOutput(runtimeId), { wrapper: wrap });
    // The runtime list has loaded once a declared runtime reads; the undeclared ones must still read none afterwards.
    if (expected === 'none') { await new Promise((r) => setTimeout(r, 30)); expect(result.current).toBe('none'); return; }
    await waitFor(() => expect(result.current).toBe(expected));
  });
});
