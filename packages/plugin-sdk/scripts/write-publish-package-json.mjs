/**
 * Writes `dist/package.json` for publishing (VS-385, design.md Decision 5): the source
 * `package.json`'s `dependencies` list the four adapter/shared SDK packages as `workspace:*` so
 * `tsc -b`'s project references resolve locally — but the published `.d.ts` is bundled
 * self-contained (`build:publish`'s `dts-bundle-generator` step) and the compiled `dist/index.js`
 * has no runtime import of any of them (every reference in `src/index.ts` is `import type`, erased
 * at compile time). A `workspace:*` specifier is meaningless — and breaks `npm install` outright —
 * outside this pnpm workspace, so the published package.json omits `dependencies` entirely rather
 * than shipping a reference nothing needs and no ordinary npm client can resolve. `npm publish`
 * runs from this directory, not the package root, so this file (not the source one) is what ships.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

const published = {
  name: source.name,
  version: source.version,
  license: source.license,
  type: source.type,
  main: './index.js',
  types: './index.d.ts',
  repository: source.repository,
  publishConfig: source.publishConfig,
  exports: { '.': { types: './index.d.ts', default: './index.js' } },
  // `npm publish` runs with `dist` itself as the package root and no explicit `files` otherwise
  // ships everything in it, including the compiled test file (`tsc -b` has no test-file exclude,
  // since nothing else in this repo publishes its own `dist/`).
  files: ['index.js', 'index.js.map', 'index.d.ts', 'index.d.ts.map'],
};

writeFileSync(join(pkgDir, 'dist', 'package.json'), JSON.stringify(published, null, 2) + '\n');
