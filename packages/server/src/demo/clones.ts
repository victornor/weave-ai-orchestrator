import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { daysAgo } from './clock.js';

/**
 * VS-770: each demo project gets a small, real git repository — a bare "origin" and a clone — built
 * from scratch in the demo directory. Nothing is fetched from anywhere: the origin is a local path, the
 * authors are invented and every commit date is fixed, so the commit ids are the same on every start.
 * The project pages, the changelog and the specs index read these repositories exactly as they read a
 * real clone, which is why they are real rather than faked in the API.
 */
interface Commit { daysAgo: number; author: string; message: string; files: Record<string, string>; branch?: string }

const AUTHORS: Record<string, string> = {
  mira: 'Mira Voss <mira@lumen.example>',
  tomas: 'Tomas Reyes <tomas@lumen.example>',
  priya: 'Priya Anand <priya@lumen.example>',
};

const spec = (name: string, purpose: string, reqs: Array<[string, string]>): string =>
  `# ${name} Specification\n\n## Purpose\n${purpose}\n\n## Requirements\n\n${reqs.map(([n, t]) => `### Requirement: ${n}\n${t}\n\n#### Scenario: Happy path\n- **WHEN** the request is valid\n- **THEN** the system behaves as described\n`).join('\n')}`;

const LEDGER_SPECS: Record<string, string> = {
  'payment-capture': spec('payment-capture', 'How the ledger records a payment capture exactly once, even when the provider retries it.', [
    ['A capture is idempotent', 'The system SHALL return the stored result for a repeated idempotency key and SHALL NOT write a second ledger entry.'],
    ['A capture records its currency', 'Every amount SHALL carry an ISO currency code.'],
  ]),
  'rate-limiting': spec('rate-limiting', 'How requests are limited so one tenant cannot starve the others.', [
    ['Requests are limited per tenant', 'The system SHALL limit requests per tenant over a window and answer 429 when the limit is exceeded.'],
  ]),
  webhooks: spec('webhooks', 'How the ledger notifies partners about events.', [
    ['Failed deliveries are retried', 'The system SHALL retry a failed webhook delivery with exponential backoff for up to 24 hours.'],
    ['Deliveries are signed', 'The system SHALL sign every delivery so a partner can verify its origin.'],
  ]),
};

const archived = (name: string, proposal: string): Record<string, string> => ({
  [`openspec/changes/archive/2026-02-10-${name}/proposal.md`]: `## Why\n${proposal}\n\n## What Changes\n- See the tasks.\n\n## Capabilities\n\n### New Capabilities\n- \`${name}\`\n`,
  [`openspec/changes/archive/2026-02-10-${name}/tasks.md`]: '## 1. Implementation\n\n- [x] 1.1 Implement it\n- [x] 1.2 Test it\n',
});

const PROJECT_COMMITS: Record<string, Commit[]> = {
  storefront: [
    { daysAgo: 58, author: 'mira', message: 'Initial storefront shell', files: { 'README.md': '# Storefront\n\nThe shop front end.\n', 'src/app.ts': 'export const app = () => "storefront";\n' } },
    { daysAgo: 44, author: 'tomas', message: 'Add the product grid and listing page', files: { 'src/grid.ts': 'export const grid = [];\n' } },
    { daysAgo: 31, author: 'priya', message: 'Add the cart store and badge (LUM-0)', files: { 'src/cart.ts': 'export const cart = new Map();\n' } },
    { daysAgo: 20, author: 'mira', message: 'Extract design tokens for colour and spacing', files: { 'src/tokens.ts': 'export const tokens = {};\n' } },
    { daysAgo: 9, author: 'tomas', message: 'Add dark mode to the storefront (LUM-1) (#318)', branch: 'edge', files: { 'src/theme.ts': 'export const theme = "system";\n' } },
    { daysAgo: 5, author: 'priya', message: 'Cache product listings at the edge (LUM-2) (#322)', branch: 'edge', files: { 'src/edge-cache.ts': 'export const ttl = 60;\n' } },
    { daysAgo: 3, author: 'mira', message: 'Localise the sitemap generator', branch: 'edge', files: { 'src/sitemap.ts': 'export const sitemap = [];\n' } },
  ],
  ledger: [
    { daysAgo: 56, author: 'tomas', message: 'Initial ledger schema and migrations', files: { 'README.md': '# Ledger API\n', 'db/001_init.sql': 'CREATE TABLE entries (id bigint primary key);\n', ...Object.fromEntries(Object.entries(LEDGER_SPECS).map(([k, v]) => [`openspec/specs/${k}/spec.md`, v])) } },
    { daysAgo: 40, author: 'priya', message: 'Add the payment capture endpoint', files: { 'src/capture.ts': 'export const capture = () => null;\n' } },
    { daysAgo: 25, author: 'tomas', message: 'Add webhook delivery with retries', files: { 'src/webhooks.ts': 'export const deliver = () => null;\n', ...archived('webhook-retries', 'Partners miss events when a delivery fails once.') } },
    { daysAgo: 12, author: 'mira', message: 'Enforce integer minor units on every amount', files: { 'src/money.ts': 'export type Money = { minor: number; currency: string };\n', ...archived('integer-money', 'Floats lost cents on large totals.') } },
    { daysAgo: 4, author: 'priya', message: 'Evaluate the Postgres 17 upgrade path (LUM-13)', files: { 'docs/postgres-17.md': '# Postgres 17\n\nFeasible with a short write freeze.\n' } },
  ],
  pocket: [
    { daysAgo: 52, author: 'mira', message: 'Initial Pocket app', files: { 'README.md': '# Pocket\n', 'src/App.tsx': 'export const App = () => null;\n' } },
    { daysAgo: 30, author: 'priya', message: 'Add order history screen', files: { 'src/orders.tsx': 'export const Orders = () => null;\n' } },
    { daysAgo: 14, author: 'tomas', message: 'Add push notification registration', files: { 'src/push.ts': 'export const register = () => null;\n' } },
    { daysAgo: 3, author: 'mira', message: 'Bump the React Native toolchain (LUM-21) (#81)', files: { 'package.json': '{"name":"pocket","version":"4.1.0"}\n' } },
  ],
  site: [
    { daysAgo: 40, author: 'priya', message: 'Initial marketing site', files: { 'README.md': '# Fernwood site\n', 'index.html': '<h1>Fernwood</h1>\n' } },
    { daysAgo: 9, author: 'mira', message: 'Add the pricing page', files: { 'pricing.html': '<h1>Pricing</h1>\n' } },
  ],
};

function git(cwd: string, args: string[], when?: string, author?: string): void {
  const [name, email] = parseAuthor(author ?? AUTHORS['mira']!);
  execFileSync('git', args, {
    cwd, stdio: 'pipe',
    env: {
      PATH: process.env['PATH'] ?? '', HOME: cwd, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email,
      ...(when ? { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } : {}),
    },
  });
}
const parseAuthor = (a: string): [string, string] => {
  const m = /^(.*) <(.*)>$/.exec(a)!;
  return [m[1]!, m[2]!];
};

/** Builds `<remotes>/<slug>.git` and a clone at `<clonePath>` whose `origin` is that bare repository. */
export function buildProjectRepo(slug: string, remotes: string, clonePath: string): void {
  const commits = PROJECT_COMMITS[slug];
  if (!commits) return;
  const bare = join(remotes, `${slug}.git`);
  mkdirSync(bare, { recursive: true });
  git(bare, ['init', '--bare', '-b', 'main']);
  const work = join(remotes, `${slug}.seed`);
  mkdirSync(work, { recursive: true });
  git(work, ['init', '-b', 'main']);
  git(work, ['remote', 'add', 'origin', bare]);
  const commit = (c: Commit): void => {
    for (const [path, body] of Object.entries(c.files)) {
      const abs = join(work, path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    }
    git(work, ['add', '-A']);
    git(work, ['commit', '-m', c.message], daysAgo(c.daysAgo), AUTHORS[c.author]);
  };
  for (const c of commits.filter((x) => !x.branch)) commit(c);
  git(work, ['push', 'origin', 'main']);
  const extra = commits.filter((x) => x.branch);
  if (extra.length) {
    git(work, ['checkout', '-b', 'edge']);
    for (const c of extra) commit(c);
    git(work, ['push', 'origin', 'edge']);
    git(work, ['checkout', 'main']);
  }
  mkdirSync(dirname(clonePath), { recursive: true });
  git(remotes, ['clone', '-q', '--branch', 'main', bare, clonePath]);
  git(clonePath, ['fetch', '-q', 'origin']);
}
