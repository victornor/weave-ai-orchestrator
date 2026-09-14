/**
 * A Node ESM resolve hook (VS-385, design.md Decision 4): redirects the bare specifier
 * `@weave-ai/plugin-sdk`, for any importer anywhere on disk, to this running release's own
 * installed copy — so a plugin living entirely outside this monorepo, with no `node_modules` of
 * its own, can `import { definePlugin } from '@weave-ai/plugin-sdk'` and still reach the exact SDK
 * build the daemon runs.
 *
 * Uses `module.registerHooks()` (Node ≥22.15/23.5, well within this repo's `>=22` floor and the
 * `26` `mise.toml` pin) rather than the deprecated, off-thread `module.register()`: the hook runs
 * synchronously in this same realm, so it needs no separate file loaded by URL and no dist/src path
 * indirection between production and a test run against sources.
 */
import { createRequire, registerHooks, type ResolveHookSync } from 'node:module';
import { pathToFileURL } from 'node:url';

const requireFromHere = createRequire(import.meta.url);

const PLUGIN_SDK_SPECIFIER = '@weave-ai/plugin-sdk';

// `registerHooks()` intercepts every resolution in the process, including the ones this hook's own
// `require.resolve()` call below triggers to find the real path — without this reentrancy guard,
// resolving `@weave-ai/plugin-sdk` for a real plugin recurses into itself forever (confirmed: it
// throws `RangeError: Maximum call stack size exceeded` when actually run, a failure a vitest run
// never reproduced, since vitest's own `@weave-ai/*` source aliasing satisfies the specifier before
// this hook's logic is ever really exercised — a scratch-daemon check with the real compiled binary
// is what caught it). The recursive re-entry falls through to `nextResolve`, which resolves the
// package normally from inside `packages/server`'s own `node_modules` — no special-casing needed for
// that inner call.
let resolving = false;

export const resolvePluginSdk: ResolveHookSync = (specifier, context, nextResolve) => {
  if (specifier === PLUGIN_SDK_SPECIFIER && !resolving) {
    resolving = true;
    try {
      const resolved = requireFromHere.resolve(PLUGIN_SDK_SPECIFIER);
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    } finally {
      resolving = false;
    }
  }
  return nextResolve(specifier, context);
};

let registered = false;

/**
 * Registers the hook once per process (call from `bin.ts`, before any workspace's plugins can
 * load). `registerHooks()` is itself additive/process-global, so this guard exists only to keep a
 * repeated call from stacking a second, redundant (if harmless) hook.
 */
export function registerPluginSdkResolveHook(): void {
  if (registered) return;
  registered = true;
  registerHooks({ resolve: resolvePluginSdk });
}

/** Test-only: lets a test that exercises registration twice observe a fresh, unregistered state. */
export function resetPluginSdkResolveHookForTest(): void {
  registered = false;
}
