import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve every workspace package to its TypeScript source instead of `main: dist/index.js`.
 * Without this the suite cannot even be collected on a fresh checkout — vite fails on the
 * missing entry points — and `packages/db` looks for its migrations next to the loaded module,
 * so it would need `dist/migrations` (a build artefact) rather than `src/migrations`.
 * Mirrors the globs in pnpm-workspace.yaml.
 */
function workspaceAliases(): Record<string, string> {
  const alias: Record<string, string> = {};
  for (const group of ['packages', 'packages/runtimes', 'packages/channels', 'packages/surfaces', 'examples/plugins']) {
    const groupDir = resolve(here, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(groupDir, entry.name);
      const manifest = join(dir, 'package.json');
      const source = join(dir, 'src', 'index.ts');
      if (!existsSync(manifest) || !existsSync(source)) continue;
      const name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name;
      if (name) alias[name] = source;
    }
  }
  return alias;
}

export default defineConfig({
  resolve: { alias: workspaceAliases() },
  test: { include: ['packages/**/src/**/*.test.ts', 'packages/**/test/**/*.test.ts'], environment: 'node', testTimeout: 30000, setupFiles: ['./vitest.setup.ts'] },
});
