/**
 * The plugin-sdk resolve hook's registration guard (VS-385): idempotent even if called twice.
 *
 * `createRequire` is mocked here alongside `registerHooks`, so `resolvePluginSdk`'s own
 * module-level `requireFromHere` never touches the real filesystem: CI's test-core job runs
 * vitest straight against `src/`, with no prior `pnpm build`, so the real
 * `packages/plugin-sdk/dist/index.js` this hook resolves to in production does not exist there —
 * asserting against a fake, in-memory `resolve()` instead proves the hook's own logic (delegates to
 * `requireFromHere.resolve`, wraps the result in `pathToFileURL`, sets `shortCircuit`) without
 * depending on a build having run first. The hook's real, unmocked runtime behaviour — resolving to
 * this process's actual installed `@weave-ai/plugin-sdk` — is unchanged; only this test's fixture is.
 */
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { registerPluginSdkResolveHook, resetPluginSdkResolveHookForTest, resolvePluginSdk } from '../src/register-plugin-sdk-hook.js';

const FAKE_RESOLVED_PATH = '/fake/node_modules/@weave-ai/plugin-sdk/dist/index.js';

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return {
    ...actual,
    registerHooks: vi.fn(),
    createRequire: () => ({ resolve: (specifier: string) => `/fake/node_modules/${specifier}/dist/index.js` }),
  };
});

describe('registerPluginSdkResolveHook', () => {
  it('registers exactly once even if called twice in a row', async () => {
    resetPluginSdkResolveHookForTest();
    const { registerHooks } = await import('node:module');
    (registerHooks as unknown as ReturnType<typeof vi.fn>).mockClear();

    registerPluginSdkResolveHook();
    registerPluginSdkResolveHook();
    expect(registerHooks).toHaveBeenCalledTimes(1);
  });

  it('can register again after the test-only reset', async () => {
    resetPluginSdkResolveHookForTest();
    const { registerHooks } = await import('node:module');
    (registerHooks as unknown as ReturnType<typeof vi.fn>).mockClear();

    registerPluginSdkResolveHook();
    resetPluginSdkResolveHookForTest();
    registerPluginSdkResolveHook();
    expect(registerHooks).toHaveBeenCalledTimes(2);
  });
});

describe('resolvePluginSdk', () => {
  const nextResolve = vi.fn((specifier: string) => ({ url: `unresolved:${specifier}` }));

  it('redirects the exact specifier @weave-ai/plugin-sdk to this process\'s own installed copy', () => {
    const result = resolvePluginSdk('@weave-ai/plugin-sdk', {}, nextResolve) as { url: string; shortCircuit: boolean };
    expect(result.url).toBe(pathToFileURL(FAKE_RESOLVED_PATH).href);
    expect(result.shortCircuit).toBe(true);
    expect(nextResolve).not.toHaveBeenCalled();
  });

  it('falls through to nextResolve for every other specifier', () => {
    nextResolve.mockClear();
    resolvePluginSdk('@weave-ai/shared', {}, nextResolve);
    resolvePluginSdk('./local-file.js', {}, nextResolve);
    expect(nextResolve).toHaveBeenCalledTimes(2);
  });
});
