import type { Db } from '@weave-ai/db';
import { ago, daysAgo, DEMO_NOW_ISO } from './clock.js';
import { demoId } from './ids.js';
import * as C from './content.js';
import { scriptFor, WEAVER_SCRIPT, type ScriptedEvent } from './script.js';

/** A small deterministic generator (mulberry32), so generated usage and run figures are the same on every seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedContext { db: Db; root: string }
export interface SeedResult { workspaceId: string; slug: string; projectIds: Record<string, string>; tickets: Record<string, string>; weaverId: string }

type Json = Record<string, unknown> | unknown[];
const id = demoId;

// ---------- the fictional company ----------

/** Where the demo pretends workers live. Nothing is ever created here; the real directories are a throwaway temp path. */
const FAKE_ROOT = '/srv/weave/lumen';
const WS = { slug: 'lumen', name: 'Lumen Labs', prefix: 'LUM' };

interface ProjectSpec { slug: string; name: string; gitUrl: string; landing?: string; policies: Record<string, unknown>; maxWorkers: number }
const PROJECTS: ProjectSpec[] = [
  { slug: 'storefront', name: 'Storefront', gitUrl: 'git@git.lumen.example:lumen/storefront.git', landing: 'edge', policies: { requireCi: true, mergeMethod: 'squash', yolo: false, mergeConcurrency: 1 }, maxWorkers: 4 },
  { slug: 'ledger', name: 'Ledger API', gitUrl: 'git@git.lumen.example:lumen/ledger.git', policies: { requireCi: true, mergeMethod: 'squash', autoMergeDefault: false, visualPlanArtifact: true }, maxWorkers: 3 },
  { slug: 'pocket', name: 'Pocket App', gitUrl: 'git@git.lumen.example:lumen/pocket.git', policies: { requireCi: true, mergeMethod: 'squash', proposalApproval: 'human' }, maxWorkers: 3 },
];

interface RoleSpec { slug: string; project: string; name: string; title: string; charter: string; scope: string; status?: 'active' | 'paused' | 'pending_activation'; pauseReason?: string; maxWorkers: number; runtime: string }
const ROLES: RoleSpec[] = [
  { slug: 'frontend', project: 'storefront', name: 'Frontend Engineer', title: 'Owns the shop UI', charter: 'Builds and maintains the storefront interface: pages, components and the checkout flow.', scope: 'Everything under the storefront repository that a shopper sees.', maxWorkers: 3, runtime: 'claude' },
  { slug: 'qa', project: 'storefront', name: 'QA Engineer', title: 'Keeps releases honest', charter: 'Writes and runs the browser suite, reproduces reported bugs and signs off releases.', scope: 'The storefront test suites and the release checklist.', maxWorkers: 1, runtime: 'codex' },
  { slug: 'backend', project: 'ledger', name: 'Backend Engineer', title: 'Owns the ledger service', charter: 'Implements ledger and payment features with correctness first.', scope: 'The ledger API, its migrations and its jobs.', maxWorkers: 2, runtime: 'claude' },
  { slug: 'platform', project: 'ledger', name: 'Platform Engineer', title: 'Infrastructure and operations', charter: 'Owns deploys, databases and the operational runbooks.', scope: 'Infrastructure code, CI and production operations for the ledger.', maxWorkers: 1, runtime: 'claude' },
  { slug: 'data', project: 'ledger', name: 'Data Engineer', title: 'Reporting and exports', charter: 'Builds the exports and reporting tables finance relies on.', scope: 'Reporting tables and export jobs.', status: 'pending_activation', maxWorkers: 1, runtime: 'claude' },
  { slug: 'mobile', project: 'pocket', name: 'Mobile Engineer', title: 'Owns the Pocket app', charter: 'Builds the iOS and Android app from one React Native codebase.', scope: 'The Pocket repository.', maxWorkers: 2, runtime: 'claude' },
  { slug: 'release', project: 'pocket', name: 'Release Manager', title: 'Store submissions', charter: 'Prepares, submits and tracks store releases.', scope: 'Release tooling and store consoles.', status: 'paused', pauseReason: 'Waiting for store review to finish before the next submission', maxWorkers: 1, runtime: 'claude' },
];

type TicketKind = 'change' | 'task' | 'scout' | 'question' | 'operational';
type TicketStatus = 'backlog' | 'todo' | 'proposing' | 'proposed' | 'approved' | 'in_progress' | 'in_review' | 'merging' | 'blocked' | 'done' | 'cancelled';
interface TicketSpec {
  n: number; project: string; role: string; kind: TicketKind; status: TicketStatus; title: string; summary: string; description: string;
  priority?: 'critical' | 'high' | 'medium' | 'low'; createdAgo: number; doneAgo?: number; pr?: number; prState?: 'open' | 'merged'; worker?: 'running' | 'active' | 'paused' | 'error' | 'done';
  unblock?: { owner: 'human' | 'weaver'; action: string }; blockedBy?: number[]; plan?: string; report?: string; action?: string; autoMerge?: boolean; parent?: number; comments?: Array<[string, 'human' | 'agent' | 'system', string, number]>;
}

const TICKETS: TicketSpec[] = [
  { n: 1, project: 'storefront', role: 'frontend', kind: 'change', status: 'done', title: 'Add dark mode to the storefront', summary: 'Shoppers get a dark theme that follows their system setting.', description: 'Add a dark colour scheme. Respect the system preference on first visit and remember an explicit choice.', priority: 'medium', createdAgo: 9 * 1440, doneAgo: 6 * 1440, pr: 318, prState: 'merged', worker: 'done', plan: C.PLAN_DARK_MODE },
  { n: 2, project: 'storefront', role: 'frontend', kind: 'task', status: 'done', title: 'Cache product listings at the edge', summary: 'Listing pages are served from the edge for 60 seconds.', description: 'Cache the product listing responses at the edge with a short TTL and a purge hook.', createdAgo: 8 * 1440, doneAgo: 5 * 1440, pr: 322, prState: 'merged', worker: 'done' },
  { n: 3, project: 'storefront', role: 'frontend', kind: 'change', status: 'in_review', title: 'Redesign the checkout summary panel', summary: 'A clearer order summary with shipping and tax broken out.', description: 'Rework the checkout summary: itemised totals, shipping estimate, promo code field and an accessible layout on phones.', priority: 'high', createdAgo: 4 * 1440, pr: 331, prState: 'open', worker: 'active', comments: [['agent', 'agent', 'PR is up. The summary now breaks shipping and tax out, and the layout holds down to 320px. Screenshots are attached to the PR.', 95]] },
  { n: 4, project: 'storefront', role: 'frontend', kind: 'change', status: 'proposed', title: 'Saved carts across devices', summary: 'A signed-in shopper sees the same cart on every device.', description: 'Persist the cart against the account and merge a guest cart at sign-in.', priority: 'high', createdAgo: 2 * 1440, worker: 'active', plan: C.PLAN_SAVED_CARTS },
  { n: 5, project: 'storefront', role: 'frontend', kind: 'task', status: 'in_progress', title: 'Fix cart badge count after removing a bundle', summary: 'The badge drifts when a bundle is removed.', description: 'Removing a bundle leaves the cart badge one too high. Both stores must update.', priority: 'medium', createdAgo: 1 * 1440, worker: 'running', comments: [['agent', 'agent', 'Reproduced: the badge reads from the legacy store, which the removal path never updates. Fixing the selector and adding a regression test.', 38]] },
  { n: 6, project: 'storefront', role: 'qa', kind: 'scout', status: 'in_progress', title: 'Why did p95 checkout latency double on Friday?', summary: 'Find the cause of the Friday latency regression.', description: 'p95 checkout latency doubled around 14:10 on Friday. Find out why. Report only; no code.', priority: 'critical', createdAgo: 600, worker: 'running', report: C.REPORT_LATENCY },
  { n: 7, project: 'storefront', role: 'frontend', kind: 'change', status: 'proposing', title: 'Gift card redemption flow', summary: 'Shoppers can pay with a gift card code.', description: 'Add a gift card code field to checkout, validate it against the ledger and apply the balance.', createdAgo: 3 * 1440, worker: 'active', comments: [['human', 'human', 'Please cover partial redemption: a card with less balance than the order total. The plan only handles full redemption.', 70]] },
  { n: 8, project: 'storefront', role: 'frontend', kind: 'change', status: 'approved', title: 'Localized product pages', summary: 'Product pages render in the shopper’s language.', description: 'Serve product pages in the shopper’s locale with a per-locale cache key.', createdAgo: 5 * 1440, worker: 'active' },
  { n: 9, project: 'storefront', role: 'frontend', kind: 'operational', status: 'todo', title: 'Rotate the CDN signing key', summary: 'Replace the CDN signing key with a 24 hour overlap.', description: 'The signing key is due for rotation. Create a new key and promote it with a grace period.', priority: 'high', createdAgo: 700, worker: 'active', action: C.ACTION_CDN_KEY },
  { n: 10, project: 'ledger', role: 'backend', kind: 'change', status: 'merging', title: 'Idempotency keys for payment captures', summary: 'A retried capture never writes twice.', description: 'Store the idempotency key with the result in the capture transaction.', priority: 'high', createdAgo: 6 * 1440, pr: 214, prState: 'open', worker: 'active' },
  { n: 11, project: 'ledger', role: 'backend', kind: 'change', status: 'in_progress', title: 'Sliding-window rate limiter', summary: 'Requests are limited over a sliding window, not a fixed one.', description: 'The fixed window lets a burst through twice at the boundary. Switch to a sliding log.', priority: 'high', createdAgo: 2 * 1440, worker: 'running', comments: [['agent', 'agent', 'Plan approved, starting. The limiter and its tests are small; I will keep the change inside `src/limiter`.', 140]] },
  { n: 12, project: 'ledger', role: 'platform', kind: 'task', status: 'blocked', title: 'Backfill missing invoice currency codes', summary: 'Old invoices have no currency code.', description: 'About 1,900 invoices from 2024 have no currency code. Backfill them from the customer’s billing country.', createdAgo: 3 * 1440, worker: 'paused', unblock: { owner: 'human', action: 'Grant the platform role read access to the production replica so the backfill can be dry-run.' } },
  { n: 13, project: 'ledger', role: 'platform', kind: 'scout', status: 'done', title: 'Evaluate the Postgres 17 upgrade path', summary: 'The upgrade is feasible with about four minutes of write downtime.', description: 'Find out whether we can move the ledger database from 15 to 17 and what it costs.', createdAgo: 7 * 1440, doneAgo: 4 * 1440, worker: 'done', report: C.REPORT_POSTGRES },
  { n: 14, project: 'ledger', role: 'backend', kind: 'question', status: 'done', title: 'Do we keep the legacy /v1/ledger endpoints?', summary: 'Answered: keep them until the Q3 partner migration.', description: 'Three partners still call /v1/ledger. Can we remove it this quarter?', createdAgo: 4 * 1440, doneAgo: 4 * 1440 - 30, worker: 'done' },
  { n: 15, project: 'ledger', role: 'backend', kind: 'change', status: 'backlog', title: 'Webhook retry dashboard', summary: 'See failing webhook deliveries and retry them.', description: 'A dashboard listing failed webhook deliveries with a retry action.', priority: 'low', createdAgo: 12 * 1440 },
  { n: 16, project: 'ledger', role: 'backend', kind: 'task', status: 'cancelled', title: 'Remove the deprecated audit export job', summary: 'Cancelled: finance still uses it.', description: 'Remove the nightly audit export job.', priority: 'low', createdAgo: 10 * 1440, doneAgo: 2 * 1440 },
  { n: 17, project: 'ledger', role: 'backend', kind: 'change', status: 'todo', title: 'Per-tenant export quotas', summary: 'Limit export size per tenant.', description: 'Cap the rows a tenant can export per day and report the remaining quota.', priority: 'medium', createdAgo: 900 },
  { n: 18, project: 'pocket', role: 'mobile', kind: 'change', status: 'in_review', title: 'Biometric unlock on Android', summary: 'Unlock the app with a fingerprint or face.', description: 'Add biometric unlock with a passcode fallback, using the platform prompt.', priority: 'high', createdAgo: 3 * 1440, pr: 87, prState: 'open', worker: 'active', comments: [['agent', 'agent', 'Delivered. The prompt falls back to the passcode after three failed attempts, and the setting is off by default.', 200]] },
  { n: 19, project: 'pocket', role: 'mobile', kind: 'task', status: 'blocked', title: 'Crash on cold start with no network', summary: 'The app crashes at launch when offline.', description: 'Reading remote config at launch throws when there is no network.', priority: 'high', createdAgo: 2 * 1440, worker: 'paused', blockedBy: [20], unblock: { owner: 'weaver', action: 'Waiting for the offline cache from LUM-20 to land.' } },
  { n: 20, project: 'pocket', role: 'mobile', kind: 'change', status: 'in_progress', title: 'Offline mode for the order history', summary: 'Past orders are readable without a network.', description: 'Cache order history locally and show it with a stale marker when offline.', priority: 'medium', createdAgo: 2 * 1440, worker: 'error' },
  { n: 21, project: 'pocket', role: 'mobile', kind: 'task', status: 'done', title: 'Bump the React Native toolchain', summary: 'Upgraded to the latest stable toolchain.', description: 'Update React Native and its build tooling.', createdAgo: 6 * 1440, doneAgo: 3 * 1440, pr: 81, prState: 'merged', worker: 'done' },
  { n: 22, project: 'pocket', role: 'release', kind: 'operational', status: 'todo', title: 'Submit Pocket 4.2 to the app stores', summary: 'Release 4.2 to both stores.', description: 'Submit the 4.2 build to review on iOS and start the Android staged rollout.', priority: 'high', createdAgo: 500, action: C.ACTION_APP_STORES },
  { n: 23, project: 'pocket', role: 'mobile', kind: 'task', status: 'todo', title: 'Document the release checklist', summary: 'Write down what a release needs.', description: 'Turn the release steps into a checklist in the project knowledge base.', priority: 'low', createdAgo: 400 },
  { n: 24, project: 'pocket', role: 'mobile', kind: 'change', status: 'proposed', title: 'Push notification preferences', summary: 'Shoppers choose which notifications they get.', description: 'Order updates, price drops and promotions, each on its own switch.', priority: 'medium', createdAgo: 300, worker: 'active', plan: C.PLAN_PUSH_PREFS },
  { n: 25, project: 'ledger', role: 'backend', kind: 'change', status: 'in_review', title: 'Cursor pagination for ledger exports', summary: 'Large exports stream in pages instead of timing out.', description: 'Replace offset pagination on the export endpoint with an opaque cursor so large ledgers export without timeouts.', priority: 'medium', createdAgo: 2 * 1440, pr: 219, prState: 'open', worker: 'active', comments: [['agent', 'agent', 'PR is up and CI is running. Exports of 2 million rows now stream in 5,000-row pages, and the old offset parameter still works for existing callers.', 30]] },
];

const changeNameOf = (t: TicketSpec): string => `lum-${t.n}-${t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '')}`;
const branchOf = (t: TicketSpec): string => `ac/${changeNameOf(t)}`;
const prUrlOf = (t: TicketSpec): string => `https://github.com/lumen-labs/${t.project}/pull/${t.pr}`;

// ---------- seeding ----------

export function seedLumen(c: SeedContext): SeedResult {
  const { db, root } = c;
  const workspaceId = id('ws:lumen');
  const wsOf = { workspaceId };
  db.insert('workspaces', { id: workspaceId, slug: WS.slug, name: WS.name, ticketPrefix: WS.prefix, ticketCounter: TICKETS.length, status: 'active', rootPath: root, settingsJson: {}, createdAt: daysAgo(60), updatedAt: ago(5) });

  // projects
  const projectIds: Record<string, string> = {};
  for (const p of PROJECTS) {
    const pid = id(`project:${p.slug}`);
    projectIds[p.slug] = pid;
    db.insert('projects', {
      id: pid, ...wsOf, slug: p.slug, name: p.name, gitUrl: p.gitUrl, defaultBranch: 'main', landingBranch: p.landing ?? null, clonePath: `${root}/projects/${p.slug}`,
      maxWorkers: p.maxWorkers, worktreeProvider: 'git', openspecEnabled: 1, policiesJson: p.policies, status: 'ready', lastFetchedAt: ago(12),
      syncState: p.slug === 'storefront' ? 'behind' : 'in_sync', createdAt: daysAgo(55), updatedAt: ago(12),
    });
  }

  // roles
  const roleIds: Record<string, string> = {};
  for (const r of ROLES) {
    const rid = `${r.project}-${r.slug}`; // a role's id is its kebab-case slug in the product
    roleIds[`${r.project}:${r.slug}`] = rid;
    db.insert('roles', {
      id: rid, ...wsOf, projectId: projectIds[r.project], slug: r.slug, name: r.name, title: r.title, charterSummary: r.charter, scopeText: r.scope,
      responsibilitiesJson: ['Pick up assigned tickets and deliver them through a pull request', 'Keep the project knowledge base accurate', 'Ask when a decision belongs to captain'],
      capabilitiesJson: ['Read and write the repository', 'Run the project test suite'], rulesJson: ['Never push to the default branch', 'Attach evidence to every claim'],
      permissionJson: { mode: 'auto' }, sessionPolicy: 'per_ticket', maxWorkers: r.maxWorkers, status: r.status ?? 'active', pauseReason: r.pauseReason ?? null,
      specRevision: 1, createdBy: 'weaver', createdAt: daysAgo(50), updatedAt: daysAgo(3), mcpServersJson: [],
    });
    db.insert('role_revisions', { id: id(`rolerev:${r.project}:${r.slug}`), roleId: rid, revision: 1, changedKeysJson: [], beforeJson: {}, afterJson: { name: r.name }, author: 'weaver', reason: 'Created from the hire request', createdAt: daysAgo(50) });
  }

  // weaver
  const weaverId = id('agent:weaver');
  db.insert('agents', {
    id: weaverId, ...wsOf, kind: 'weaver', name: 'Weaver', runtimeId: 'claude', status: 'running', homePath: `${FAKE_ROOT}/weaver`, turnEpoch: 214, turnCount: 214,
    spawnedBy: 'system', briefRevision: 3, lastRunAt: ago(1), createdAt: daysAgo(60), updatedAt: ago(1),
  });

  // tickets + workers
  const ticketIds: Record<string, string> = {};
  const workerOf: Record<number, string> = {};
  const nameCounts: Record<string, number> = {};
  for (const t of TICKETS) {
    const tid = id(`ticket:${t.n}`);
    ticketIds[`${WS.prefix}-${t.n}`] = tid;
    const roleKey = `${t.project}:${t.role}`;
    const role = ROLES.find((r) => `${r.project}:${r.slug}` === roleKey)!;
    let workerId: string | null = null;
    if (t.worker) {
      workerId = id(`agent:worker:${t.n}`);
      workerOf[t.n] = workerId;
      nameCounts[role.name] = (nameCounts[role.name] ?? 600) + 7;
      const agentStatus = t.worker === 'running' ? 'running' : t.worker === 'active' ? 'active' : t.worker === 'paused' ? 'paused' : t.worker === 'error' ? 'error' : 'done';
      const live = t.status !== 'done' && t.status !== 'cancelled';
      db.insert('agents', {
        id: workerId, ...wsOf, kind: 'worker', projectId: projectIds[t.project], roleId: roleIds[roleKey], roleRevision: 1, ticketId: tid, name: `${role.name} #${nameCounts[role.name]}`,
        runtimeId: role.runtime, status: agentStatus, homePath: `${FAKE_ROOT}/workers/${workerId}`, worktreePath: live ? `${FAKE_ROOT}/workers/${workerId}/work` : null, branch: live ? branchOf(t) : null,
        pauseReason: agentStatus === 'paused' ? (t.n === 12 ? 'Blocked on a human decision' : 'Blocked on another ticket') : null,
        pauseDetailJson: agentStatus === 'paused' ? { family: null, code: null, message: null, resetAt: null, runId: null } : null,
        errorText: agentStatus === 'error' ? 'The turn ended without a report: the runtime exited with code 1 after a network timeout.' : null,
        turnEpoch: 3, turnCount: 3, spawnedBy: 'weaver', spawnReason: `Assigned ${WS.prefix}-${t.n}`, briefRevision: 1,
        lastRunAt: ago(Math.max(3, (t.n * 13) % 180)), retiredAt: t.worker === 'done' ? daysAgo(2) : null, createdAt: ago(t.createdAgo - 5), updatedAt: ago(Math.max(3, (t.n * 13) % 180)),
      });
    }
    const isDone = t.status === 'done';
    const hasChange = t.kind === 'change';
    const prUrl = t.pr ? prUrlOf(t) : null;
    const delivery: Json | null = prUrl
      ? { prUrl, prState: t.prState ?? 'open', ...(isDone ? { merged: true, mergeCommit: demoId(`merge:${t.n}`).toLowerCase().padEnd(40, 'a').slice(0, 40), method: 'squash', landedOn: t.project === 'storefront' ? 'edge' : 'main' } : {}) }
      : null;
    db.insert('tickets', {
      id: tid, ...wsOf, projectId: projectIds[t.project], number: t.n, identifier: `${WS.prefix}-${t.n}`, kind: t.kind, title: t.title, description: t.description, summary: t.summary,
      status: t.status, priority: t.priority ?? 'medium', autoMerge: t.autoMerge ? 1 : 0, assigneeRoleId: roleIds[roleKey], workerId, assigneeHuman: 0, parentId: null,
      createdByKind: 'agent', createdById: weaverId, openspecChangeName: hasChange ? changeNameOf(t) : null,
      openspecStateJson: hasChange ? { enabled: true, changeName: changeNameOf(t), planningComplete: t.status !== 'proposing', artifacts: [{ id: 'proposal', status: 'done' }, { id: 'specs', status: 'done' }, { id: 'design', status: 'done' }, { id: 'tasks', status: 'done' }], tasks: ['Define the behaviour', 'Implement it', 'Cover it with tests', 'Update the docs'].map((text, i) => ({ text, done: isDone || t.status === 'in_review' || t.status === 'merging' ? true : t.status === 'in_progress' ? i < 2 : false })), applyState: isDone ? 'all_done' : 'ready', validation: { ok: true, issues: [] }, archived: isDone } : null,
      deliveryJson: delivery, unblockJson: t.unblock ?? null, blockedFromStatus: t.unblock ? 'in_progress' : null, blockedTransitionAt: t.unblock ? ago(180) : null,
      startedAt: t.status === 'backlog' || t.status === 'todo' ? null : ago(t.createdAgo - 20), completedAt: isDone ? ago(t.doneAgo ?? 60) : null, cancelledAt: t.status === 'cancelled' ? ago(t.doneAgo ?? 60) : null,
      createdAt: ago(t.createdAgo), updatedAt: ago(Math.min(t.createdAgo, (t.doneAgo ?? ((t.n * 11) % 240) + 4))), createdRunId: null,
      mergeQueuedAt: t.status === 'merging' ? ago(14) : null, mergeStartedAt: t.status === 'merging' ? ago(6) : null, interactiveSession: 0, mergeBypasses: 0, planArtifactRequired: 0,
    });
    // worktree row for live tickets
    if (workerId && t.status !== 'done' && t.status !== 'cancelled') {
      db.insert('worktrees', { id: id(`worktree:${t.n}`), projectId: projectIds[t.project], ticketId: tid, agentId: workerId, provider: 'git', path: `${FAKE_ROOT}/workers/${workerId}/work`, branch: branchOf(t), status: t.status === 'in_progress' ? 'dirty' : 'active', createdAt: ago(t.createdAgo - 10) });
    }
    // work products
    if (prUrl) {
      db.insert('ticket_work_products', { id: id(`wp:pr:${t.n}`), ticketId: tid, runId: null, type: 'pull_request', provider: 'github', externalId: String(t.pr), url: prUrl, title: t.title, state: t.prState ?? 'open', isPrimary: 1, metadataJson: { number: t.pr }, createdAt: ago(Math.max(10, t.createdAgo - 120)), updatedAt: ago(Math.min(t.createdAgo, 60)) });
    } else if (workerId && t.status === 'in_progress' && t.kind !== 'scout') {
      db.insert('ticket_work_products', { id: id(`wp:branch:${t.n}`), ticketId: tid, runId: null, type: 'branch', provider: 'git', externalId: branchOf(t), url: null, title: branchOf(t), state: 'open', isPrimary: 1, metadataJson: {}, createdAt: ago(200), updatedAt: ago(30) });
    }
    // documents
    const putDoc = (key: string, body: string, rev = 1): { docId: string; rev: number } => {
      const docId = id(`doc:${t.n}:${key}`);
      db.insert('ticket_documents', { id: docId, ticketId: tid, key, currentRevision: rev });
      for (let r = 1; r <= rev; r += 1) {
        db.insert('ticket_document_revisions', { id: id(`docrev:${t.n}:${key}:${r}`), documentId: docId, revision: r, body: r === rev ? body : `${body}\n\n(earlier draft)`, authorKind: 'agent', authorId: workerId, runId: null, createdAt: ago(Math.max(20, t.createdAgo - 60 - (rev - r) * 30)) });
      }
      return { docId, rev };
    };
    let planDoc: { docId: string; rev: number } | null = null;
    let actionDoc: { docId: string; rev: number } | null = null;
    if (t.plan) planDoc = putDoc('plan', t.plan, t.n === 7 ? 2 : 1);
    if (t.report) putDoc('report', t.report);
    if (t.action) actionDoc = putDoc('action', t.action);

    // comments
    for (const [i, [kind, author, body, minutes]] of (t.comments ?? []).entries()) {
      db.insert('ticket_comments', { id: id(`comment:${t.n}:${i}`), ticketId: tid, authorKind: author, authorId: author === 'human' ? 'captain' : workerId, runId: null, body, kind: kind === 'human' ? 'comment' : 'status', sourceTrust: author === 'human' ? 'trusted' : 'agent', createdAt: ago(minutes) });
    }
    if (isDone) db.insert('ticket_comments', { id: id(`comment:${t.n}:done`), ticketId: tid, authorKind: 'system', authorId: null, runId: null, body: t.pr ? `merged ${prUrl}` : 'completed', kind: 'status', sourceTrust: 'trusted', createdAt: ago(t.doneAgo ?? 60) });

    // decisions
    const decision = (key: string, row: Record<string, unknown>): void => {
      db.insert('decisions', { id: id(`decision:${key}`), ...wsOf, ticketId: tid, projectId: projectIds[t.project], status: 'open', allowFreeText: 1, askedByAgentId: workerId, owner: 'human', optionsJson: [], inputsJson: [], weaverReviewStatus: 'unseen', createdAt: ago(Math.min(t.createdAgo, 90)), ...row });
    };
    const planOptions = [{ key: 'approve', label: 'Approve plan', recommended: true }, { key: 'revise', label: 'Request revision', description: 'Send it back with feedback.' }, { key: 'reject', label: 'Reject' }];
    if (t.status === 'proposed' && planDoc) {
      decision(`plan:${t.n}`, { kind: 'plan_approval', title: `Approve the plan for ${WS.prefix}-${t.n}: ${t.title}`, context: t.summary, optionsJson: planOptions, targetJson: { documentId: planDoc.docId, revision: planDoc.rev }, correlationKey: `plan_approval:${tid}`,
        ...(t.n === 4 ? { weaverReviewStatus: 'looked', weaverReviewedAt: ago(25), weaverReviewNote: 'The plan matches the ask and the merge rule for conflicting carts is explicit. No concerns.' } : {}) });
    }
    if (t.status === 'in_review' && t.n !== 25) {
      decision(`merge:${t.n}`, { kind: 'merge_approval', title: `Approve the merge for ${WS.prefix}-${t.n}: ${t.title}`, context: `Work product: ${prUrl}`, optionsJson: [{ key: 'approve', label: 'Approve merge', recommended: true }, { key: 'changes', label: 'Request changes', description: 'Send it back to the worker.' }], correlationKey: `merge_approval:${tid}`,
        ...(t.n === 18 ? { weaverReviewStatus: 'concerns', weaverReviewedAt: ago(40), weaverReviewNote: 'The biometric prompt is not shown on devices without enrolled biometrics; the fallback path has no test.', weaverReviewWaitingOn: 'worker' } : {}) });
    }
    if (t.kind === 'operational' && actionDoc) {
      decision(`action:${t.n}`, { kind: 'action_approval', title: `Approve the action for ${WS.prefix}-${t.n}: ${t.title}`, context: t.summary, optionsJson: planOptions, targetJson: { documentId: actionDoc.docId, revision: actionDoc.rev }, correlationKey: `action_approval:${tid}`,
        ...(t.n === 22 ? { weaverReviewStatus: 'looked', weaverReviewedAt: ago(15), weaverReviewNote: 'Commands match the release runbook; the Android rollout starts at 10 percent.' } : {}) });
    }
    if (t.status === 'merging') {
      decision(`merge:${t.n}`, { kind: 'merge_approval', status: 'answered', title: `Approve the merge for ${WS.prefix}-${t.n}: ${t.title}`, context: `Work product: ${prUrl}`, optionsJson: [{ key: 'approve', label: 'Approve merge', recommended: true }, { key: 'changes', label: 'Request changes' }], answerKey: 'approve', answeredByKind: 'human', answeredById: 'captain', answerAuthorKind: 'human', answeredAt: ago(20), correlationKey: `merge_approval:${tid}` });
    }
  }
  // The product stores a blocker as (blocker -> blocked): `ticket_id` blocks `related_ticket_id`.
  for (const t of TICKETS) for (const b of t.blockedBy ?? []) {
    db.insert('ticket_relations', { ticketId: id(`ticket:${b}`), relatedTicketId: id(`ticket:${t.n}`), kind: 'blocks' });
  }

  seedActivity(db, workspaceId, projectIds, roleIds, weaverId, ticketIds);
  seedCards(db, workspaceId, projectIds, roleIds, weaverId, ticketIds);
  seedRuns(db, workspaceId, root, projectIds, roleIds, weaverId, ticketIds, workerOf);
  seedUsage(db, workspaceId, projectIds, roleIds, weaverId, workerOf, ticketIds);
  seedKnowledgeUsage(db, workspaceId, projectIds, weaverId, workerOf, ticketIds);
  seedRoutines(db, workspaceId);
  seedRoadmap(db, projectIds, roleIds);
  seedChat(db, workspaceId, weaverId);
  seedRuntimeAccounts(db, workspaceId);
  return { workspaceId, slug: WS.slug, projectIds, tickets: ticketIds, weaverId };
}

// ---------- the activity record (changelog, project landings) ----------

function seedActivity(db: Db, workspaceId: string, projectIds: Record<string, string>, roleIds: Record<string, string>, weaverId: string, tickets: Record<string, string>): void {
  const row = (key: string, action: string, entityType: string, entityId: string, at: string, details: Json, ticketId: string | null, projectId: string | null, actor: { kind: string; id: string | null } = { kind: 'agent', id: weaverId }): void => {
    db.insert('activity', { id: id(`activity:${key}`), workspaceId, actorKind: actor.kind, actorId: actor.id, action, entityType, entityId, ticketId, detailsJson: details, createdAt: at, projectId });
  };
  for (const r of ROLES) row(`hire:${r.project}:${r.slug}`, 'role.hire', 'role', roleIds[`${r.project}:${r.slug}`]!, daysAgo(50), { role: r.name }, null, projectIds[r.project]!);
  for (const t of TICKETS) {
    const tid = tickets[`${WS.prefix}-${t.n}`]!;
    const pid = projectIds[t.project]!;
    row(`create:${t.n}`, 'ticket.create', 'ticket', tid, ago(t.createdAgo), { kind: t.kind, title: t.title }, tid, pid);
    if (t.kind === 'change' && ['approved', 'in_progress', 'in_review', 'merging', 'done'].includes(t.status)) row(`approved:${t.n}`, 'ticket.transition', 'ticket', tid, ago(t.createdAgo - 60), { from: 'proposed', to: 'approved' }, tid, pid, { kind: 'human', id: 'captain' });
    if (t.pr) row(`pr:${t.n}`, 'ticket.work_product', 'ticket', tid, ago(Math.max(10, t.createdAgo - 120)), { type: 'pull_request', url: prUrlOf(t) }, tid, pid);
    if (t.status === 'done' && t.pr) row(`landed:${t.n}`, 'ticket.delivery_landed', 'ticket', tid, ago(t.doneAgo ?? 60), { mode: 'pr', landing: t.project === 'storefront' ? 'edge' : 'main', detail: `squash merged ${prUrlOf(t)}` }, tid, pid, { kind: 'system', id: null });
    if (t.status === 'cancelled') row(`cancel:${t.n}`, 'ticket.cancel', 'ticket', tid, ago(t.doneAgo ?? 60), { reason: 'finance still uses it' }, tid, pid, { kind: 'human', id: 'captain' });
  }
  row('upgraded', 'daemon.upgraded', 'daemon', 'daemon', daysAgo(6), { from: '0.41.2', to: '0.42.0' }, null, null, { kind: 'system', id: null });
}

// ---------- decisions that belong to no single ticket ----------

function seedCards(db: Db, workspaceId: string, projectIds: Record<string, string>, roleIds: Record<string, string>, weaverId: string, _tickets: Record<string, string>): void {
  const base = { workspaceId, owner: 'human', allowFreeText: 1, askedByAgentId: weaverId, weaverReviewStatus: 'unseen', status: 'open' };
  db.insert('decisions', { id: id('decision:q:provider'), ...base, kind: 'question', projectId: projectIds['ledger'], title: 'Which payment provider should the sandbox default to?',
    context: 'New developers hit the sandbox first. Two providers have free sandboxes; they differ in how they simulate declines.', createdAt: ago(55),
    optionsJson: [{ key: 'northwind', label: 'Northwind Pay', description: 'Simulates declines with magic card numbers.', recommended: true }, { key: 'harbor', label: 'Harbor', description: 'Declines by amount; simpler to script.' }],
    inputsJson: [
      { key: 'region', label: 'Default region', type: 'single_choice', required: true, choices: [{ key: 'eu', label: 'Europe', recommended: true }, { key: 'us', label: 'United States' }, { key: 'apac', label: 'Asia-Pacific' }] },
      { key: 'notes', label: 'Anything the engineer should know', type: 'multiline', placeholder: 'Optional' },
    ], correlationKey: 'question:provider' });
  db.insert('decisions', { id: id('decision:q:retention'), ...base, kind: 'question', projectId: projectIds['storefront'], title: 'How long should we keep abandoned carts?',
    context: 'Saved carts need a retention rule. Shorter is cheaper and friendlier to privacy; longer helps win-back emails.', createdAt: ago(210),
    optionsJson: [{ key: '30', label: '30 days', recommended: true }, { key: '90', label: '90 days' }, { key: '365', label: 'One year' }], correlationKey: 'question:retention' });
  db.insert('decisions', { id: id('decision:hire:data'), ...base, kind: 'hire_approval', projectId: projectIds['ledger'], title: 'Hire a Data Engineer for Ledger API',
    context: 'Finance exports are growing and the backend role is the only one touching them. A dedicated role would own reporting tables and the export jobs.',
    optionsJson: [{ key: 'approve', label: 'Approve hire', recommended: true }, { key: 'reject', label: 'Reject' }], targetJson: { roleId: roleIds['ledger:data'] }, correlationKey: 'hire_approval:data', createdAt: ago(130) });
  db.insert('decisions', { id: id('decision:promote:storefront'), ...base, kind: 'promotion_approval', projectId: projectIds['storefront'], title: 'Promote storefront edge to main',
    context: 'Edge is 6 tickets ahead of main: dark mode, edge caching and four smaller changes. CI is green on edge.',
    optionsJson: [{ key: 'approve', label: 'Promote', recommended: true }, { key: 'decline', label: 'Not yet' }], correlationKey: 'promotion_approval:storefront', createdAt: ago(75) });
  // history
  db.insert('decisions', { id: id('decision:old:1'), ...base, kind: 'question', projectId: projectIds['ledger'], ticketId: id('ticket:14'), status: 'answered', title: 'Do we keep the legacy /v1/ledger endpoints?',
    context: 'Three partners still call /v1/ledger.', createdAt: daysAgo(4.1), answeredAt: daysAgo(4), answerKey: 'keep', answeredByKind: 'human', answeredById: 'captain', answerAuthorKind: 'human',
    optionsJson: [{ key: 'keep', label: 'Keep until Q3' }, { key: 'remove', label: 'Remove now' }], correlationKey: 'question:v1' });
  db.insert('decisions', { id: id('decision:old:2'), ...base, kind: 'plan_approval', projectId: projectIds['storefront'], ticketId: id('ticket:1'), status: 'answered', title: 'Approve the plan for LUM-1: Add dark mode to the storefront',
    context: 'Dark theme that follows the system setting.', createdAt: daysAgo(8.8), answeredAt: daysAgo(8.7), answerKey: 'approve', answeredByKind: 'human', answeredById: 'captain', answerAuthorKind: 'human',
    optionsJson: [{ key: 'approve', label: 'Approve plan' }], correlationKey: 'plan_approval:old1' });
}

// ---------- runs ----------

export function eventRows(db: Db, runId: string, script: ScriptedEvent[], startedMinutesAgo: number, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const ev = script[i % script.length]!;
    db.insert('run_events', { runId, seq: i + 1, ts: ago(startedMinutesAgo - i * 0.4), type: ev.type, stream: ev.stream ?? 'runtime', level: 'info', payloadJson: ev.payload });
  }
}

const projectOfTicket = (ticketId: string): string | null => TICKETS.find((t) => id(`ticket:${t.n}`) === ticketId)?.project ?? null;
const kindOfTicket = (ticketId: string): string | null => TICKETS.find((t) => id(`ticket:${t.n}`) === ticketId)?.kind ?? null;

const DELIVERED: Record<number, string> = {
  3: 'Opened the PR: shipping and tax are broken out; layout holds to 320px.',
  10: 'Capture writes now store the idempotency key in the same transaction.',
  18: 'Biometric prompt falls back to the passcode after three failed attempts.',
  25: 'PR is up; waiting for CI.',
};

function seedRuns(db: Db, workspaceId: string, root: string, projectIds: Record<string, string>, roleIds: Record<string, string>, weaverId: string, tickets: Record<string, string>, workerOf: Record<number, string>): void {
  const rand = rng(7);
  const mk = (key: string, agentId: string, ticketId: string | null, status: string, startedAgo: number, minutes: number, opts: { model?: string; runtime?: string; summary?: string; events?: number; script?: ScriptedEvent[]; errorCode?: string } = {}): string => {
    const runId = id(`run:${key}`);
    const input = Math.round(30_000 + rand() * 220_000);
    const output = Math.round(2_000 + rand() * 26_000);
    const running = status === 'running';
    db.insert('runs', {
      id: runId, workspaceId, agentId, ticketId, runtimeId: opts.runtime ?? 'claude', model: opts.model ?? 'claude-sonnet-5-5', status, turnEpoch: 1, cwd: `${FAKE_ROOT}/workers/${agentId}`,
      startedAt: ago(startedAgo), finishedAt: running ? null : ago(startedAgo - minutes), exitCode: running ? null : status === 'failed' ? 1 : 0,
      usageJson: { inputTokens: input, outputTokens: output, cachedInputTokens: Math.round(input * 0.6), contextTokens: Math.round(input * 0.35), basis: 'per_turn' },
      costCents: Math.round((input * 0.3 + output * 1.5) / 1000), summary: opts.summary ?? null, lastEventAt: running ? ago(0.5) : ago(startedAgo - minutes), createdAt: ago(startedAgo + 1),
      errorCode: opts.errorCode ?? null, lastProgressAt: running ? ago(0.5) : null, lastError: status === 'failed' ? 'network timeout' : null,
      wakeupIdsJson: [], liveness: running ? 'active' : null,
    });
    eventRows(db, runId, opts.script ?? scriptFor('worker', ticketId ? projectOfTicket(ticketId) : null, ticketId ? kindOfTicket(ticketId) : null), startedAgo, opts.events ?? (running ? 7 : 10));
    return runId;
  };
  const live = (n: number): string => workerOf[n]!;
  // running now
  mk('w5:live', live(5), tickets['LUM-5']!, 'running', 9, 0, { events: 6 });
  mk('w6:live', live(6), tickets['LUM-6']!, 'running', 22, 0, { events: 9 });
  mk('w11:live', live(11), tickets['LUM-11']!, 'running', 14, 0, { events: 5 });
  mk('weaver:live', weaverId, null, 'running', 2, 0, { script: WEAVER_SCRIPT, events: 5 });
  // finished
  for (const n of [1, 2, 3, 10, 13, 14, 18, 21, 25]) mk(`w${n}:a`, live(n), tickets[`LUM-${n}`]!, 'succeeded', n * 90 + 120, 14 + (n % 9), { summary: DELIVERED[n] ?? `Delivered LUM-${n}.`, model: n % 3 === 0 ? 'claude-opus-5-5' : 'claude-sonnet-5-5' });
  mk('w5:a', live(5), tickets['LUM-5']!, 'succeeded', 60, 6, { summary: 'Reproduced the badge drift; fixing the selector next.' });
  mk('w6:a', live(6), tickets['LUM-6']!, 'succeeded', 70, 8, { summary: 'Pulled the Friday traces; the jump lines up with the tax lookup deploy.' });
  mk('w11:a', live(11), tickets['LUM-11']!, 'succeeded', 80, 7, { summary: 'Plan approved; the change stays inside the limiter.' });
  mk('w8:a', live(8), tickets['LUM-8']!, 'succeeded', 500, 12, { summary: 'Plan approved. Adding the locale to the cache key next.' });
  mk('w9:a', live(9), tickets['LUM-9']!, 'succeeded', 650, 8, { summary: 'Commands written; waiting for your approval before anything runs.' });
  mk('w24:a', live(24), tickets['LUM-24']!, 'succeeded', 420, 10, { summary: 'Plan written and submitted for approval.' });
  mk('w4:a', live(4), tickets['LUM-4']!, 'succeeded', 1200, 11, { summary: 'Plan written and submitted for approval.' });
  mk('w7:a', live(7), tickets['LUM-7']!, 'succeeded', 800, 9, { summary: 'Plan revised after feedback.' });
  mk('w12:a', live(12), tickets['LUM-12']!, 'succeeded', 400, 6, { summary: 'Blocked: needs read access to the production replica.' });
  mk('w20:fail', live(20), tickets['LUM-20']!, 'failed', 130, 31, { summary: 'Ended without a report.', errorCode: 'network', runtime: 'claude' });
  mk('w20:a', live(20), tickets['LUM-20']!, 'succeeded', 900, 17, { summary: 'Started the offline cache.' });
  for (let i = 0; i < 6; i += 1) mk(`weaver:${i}`, weaverId, null, 'succeeded', 120 + i * 190, 3 + i, { script: WEAVER_SCRIPT, summary: ['Triaged the inbox.', 'Filed LUM-23.', 'Answered captain about the release.', 'Reviewed the plan for LUM-4.', 'Checked the merge queue.', 'Wrote the morning digest.'][i], events: 6, model: 'claude-opus-5-5' });
  void projectIds; void roleIds;
}

// ---------- usage ----------

function seedUsage(db: Db, workspaceId: string, projectIds: Record<string, string>, roleIds: Record<string, string>, weaverId: string, workerOf: Record<number, string>, tickets: Record<string, string>): void {
  const rand = rng(21);
  const agents = Object.entries(workerOf);
  let n = 0;
  for (let day = 29; day >= 0; day -= 1) {
    const weekday = (new Date(ago(day * 1440)).getUTCDay() + 6) % 7;
    const busy = weekday < 5 ? 1 : 0.35;
    const events = Math.round((3 + rand() * 6) * busy * (1 + (29 - day) / 40));
    for (let i = 0; i < events; i += 1) {
      const [ticketN, agentId] = agents[Math.floor(rand() * agents.length)]!;
      const t = TICKETS.find((x) => x.n === Number(ticketN))!;
      const role = ROLES.find((r) => r.slug === t.role && r.project === t.project)!;
      const input = Math.round(40_000 + rand() * 260_000);
      const output = Math.round(3_000 + rand() * 30_000);
      const opus = rand() < 0.25;
      db.insert('usage_events', {
        id: id(`usage:${n++}`), workspaceId, projectId: projectIds[t.project], roleId: roleIds[`${t.project}:${t.role}`], agentId, ticketId: tickets[`${WS.prefix}-${t.n}`], runId: id(`usage-run:${n}`),
        runtimeId: role.runtime, provider: role.runtime === 'codex' ? 'openai' : 'anthropic', model: role.runtime === 'codex' ? 'gpt-codex-demo' : opus ? 'claude-opus-5-5' : 'claude-sonnet-5-5',
        billingType: 'subscription', inputTokens: input, cachedInputTokens: Math.round(input * 0.55), outputTokens: output,
        costCents: Math.round((input * (opus ? 0.5 : 0.3) + output * (opus ? 2.5 : 1.5)) / 1000), costStatus: 'estimated', durationMs: Math.round(120_000 + rand() * 900_000),
        occurredAt: ago(day * 1440 + Math.round(rand() * 600)),
      });
    }
  }
  for (let i = 0; i < 18; i += 1) {
    db.insert('usage_events', { id: id(`usage:weaver:${i}`), workspaceId, projectId: null, roleId: null, agentId: weaverId, ticketId: null, runId: id(`usage-wrun:${i}`), runtimeId: 'claude', provider: 'anthropic', model: 'claude-opus-5-5',
      billingType: 'subscription', inputTokens: 60_000 + (i * 7_000) % 90_000, cachedInputTokens: 40_000, outputTokens: 4_000 + (i * 900) % 6_000, costCents: 120 + (i * 17) % 90, costStatus: 'estimated', durationMs: 90_000 + i * 8_000, occurredAt: ago(i * 1300 + 30) });
  }
}

// ---------- what runs read from the knowledge base ----------

function seedKnowledgeUsage(db: Db, workspaceId: string, projectIds: Record<string, string>, weaverId: string, workerOf: Record<number, string>, tickets: Record<string, string>): void {
  const rand = rng(33);
  const reads: Array<{ project: string; scope: 'project' | 'shared' | 'workspace'; slug: string | null; kind: 'hub' | 'document'; tokens: number; weight: number }> = [
    { project: 'storefront', scope: 'project', slug: null, kind: 'hub', tokens: 420, weight: 10 },
    { project: 'ledger', scope: 'project', slug: null, kind: 'hub', tokens: 360, weight: 9 },
    { project: 'pocket', scope: 'project', slug: null, kind: 'hub', tokens: 300, weight: 6 },
    { project: 'storefront', scope: 'shared', slug: null, kind: 'hub', tokens: 180, weight: 12 },
    { project: 'storefront', scope: 'workspace', slug: null, kind: 'hub', tokens: 250, weight: 4 },
    { project: 'storefront', scope: 'project', slug: 'cart-state', kind: 'document', tokens: 330, weight: 5 },
    { project: 'ledger', scope: 'project', slug: 'capture-idempotency', kind: 'document', tokens: 410, weight: 4 },
  ];
  const agents = Object.entries(workerOf);
  let n = 0;
  for (let i = 0; i < 70; i += 1) {
    const read = reads[Math.floor(rand() * reads.length)]!;
    const [ticketN, agentId] = agents[Math.floor(rand() * agents.length)]!;
    db.insert('knowledge_usage_events', { id: id(`kuse:${n++}`), workspaceId, runId: id(`usage-run:${i}`), agentId: i % 9 === 0 ? weaverId : agentId, ticketId: i % 9 === 0 ? null : tickets[`${WS.prefix}-${ticketN}`], projectId: projectIds[read.project], kind: read.kind, scope: read.scope, docProjectId: read.scope === 'project' ? projectIds[read.project] : null, slug: read.slug, tokens: read.tokens, occurredAt: ago(Math.floor(rand() * 6 * 1440) + 10) });
  }
}

// ---------- incidents (the daemon's own database, not a workspace's), routines ----------

/** Incidents are filed against the daemon, so they live in `daemon.sqlite`; the references are the workspace's fixed ids. */
export function seedDaemonIncidents(db: Db): void {
  const workspaceId = id('ws:lumen');
  const weaverId = id('agent:weaver');
  const projectIds: Record<string, string> = { storefront: id('project:storefront'), ledger: id('project:ledger'), pocket: id('project:pocket') };
  const tickets: Record<string, string> = { 'LUM-6': id('ticket:6'), 'LUM-20': id('ticket:20'), 'LUM-10': id('ticket:10') };
  const roleIds: Record<string, string> = { 'pocket:mobile': 'pocket-mobile' };
  const inc = (key: string, row: Record<string, unknown>): void => {
    db.insert('incidents', { id: id(`incident:${key}`), reporterKind: 'agent', workspaceId, agentId: weaverId, runId: id('run:weaver:0'), ...row });
  };
  inc('1', { title: 'Weave call timed out while creating a ticket', whatFailed: 'weave_ticket_create returned a timeout after 30 seconds.', tryingToDo: 'File a scout ticket for the Friday latency regression.', evidence: 'error: request timed out (retryable)', projectId: projectIds['storefront'], ticketId: tickets['LUM-6'], createdAt: ago(190) });
  inc('2', { title: 'Worker memory limit hit twice on LUM-20', whatFailed: 'The worker for LUM-20 was killed at its memory limit on two consecutive turns.', tryingToDo: 'Build the offline cache for the order history.', evidence: 'peak 6.1 GB against a 6 GB limit', projectId: projectIds['pocket'], ticketId: tickets['LUM-20'], roleId: roleIds['pocket:mobile'], createdAt: ago(140) });
  inc('3', { title: 'Merge check list was empty for LUM-10', whatFailed: 'The forge reported no checks for a pull request on a repository with CI.', tryingToDo: 'Land LUM-10.', evidence: 'rollup: []', projectId: projectIds['ledger'], ticketId: tickets['LUM-10'], createdAt: daysAgo(2), resolvedAt: daysAgo(1.9), resolvedByAgentId: weaverId, resolution: 'The check run appeared after a minute; the wait limit now covers this case.' });

}

function seedRoutines(db: Db, workspaceId: string): void {


  const routine = (key: string, name: string, trigger: Json, template: Json, nextMin: number, lastMin: number | null, status = 'active'): void => {
    db.insert('routines', { id: id(`routine:${key}`), workspaceId, name, triggerJson: trigger, templateJson: template, roleId: null, concurrency: 'skip_if_active', status, lastFiredAt: lastMin === null ? null : ago(lastMin), nextFireAt: ago(-nextMin), createdAt: daysAgo(30), updatedAt: daysAgo(2) });
  };
  routine('digest', 'Morning digest', { kind: 'schedule', timezone: 'Europe/Copenhagen', daily: { hour: 8, minute: 0 } }, { instruction: 'Write the morning digest for captain: what landed, what is waiting on them, what is blocked.', action: 'report', maxTicketsPerFire: 0 }, 17 * 60 + 30, 6 * 60 + 30);
  routine('deps', 'Weekly dependency check', { kind: 'schedule', timezone: 'Europe/Copenhagen', everyMinutes: 10080 }, { instruction: 'Check each project for outdated dependencies and file one task per project that needs work.', action: 'file_work', maxTicketsPerFire: 3 }, 6 * 1440 + 1100, 5 * 60 + 30);
  routine('knowledge', 'Knowledge curation sweep', { kind: 'schedule', timezone: 'UTC', everyMinutes: 1440 }, { instruction: 'Curate knowledge files that are over budget or stale.', action: 'report', maxTicketsPerFire: 0 }, 11 * 60, 13 * 60);
  routine('backup', 'Nightly ledger backup check', { kind: 'schedule', timezone: 'UTC', daily: { hour: 2, minute: 30 } }, { instruction: 'Verify last night’s ledger backup restored cleanly.', action: 'file_work', maxTicketsPerFire: 1 }, 12 * 60 - 30, 14 * 60 + 30, 'paused');
}

// ---------- roadmap ----------

function seedRoadmap(db: Db, projectIds: Record<string, string>, roleIds: Record<string, string>): void {
  const pid = projectIds['storefront']!;
  const block = (key: string, title: string, notes: string, position: number, status: string): string => {
    const bid = id(`block:${key}`);
    db.insert('roadmap_blocks', { id: bid, projectId: pid, title, notes, position, status, startedAt: status === 'started' ? daysAgo(6) : null, createdByKind: 'human', createdById: 'captain', createdAt: daysAgo(14), updatedAt: daysAgo(3) });
    return bid;
  };
  const q1 = block('checkout', 'Checkout rework', 'Faster, calmer checkout. Ship in this order.', 0, 'started');
  const q2 = block('growth', 'Growth experiments', 'After the checkout rework lands.', 1, 'open');
  const item = (key: string, title: string, blockId: string | null, position: number, status: 'idea' | 'planned' | 'dropped', kind: TicketKind, ticketN: number | null): void => {
    db.insert('roadmap_items', { id: id(`item:${key}`), projectId: pid, title, notes: '', position, status, ticketId: ticketN ? id(`ticket:${ticketN}`) : null, createdByKind: 'human', createdById: 'captain', createdAt: daysAgo(12), updatedAt: daysAgo(2), blockId, description: `${title}.`, kind, priority: 'medium', roleId: roleIds['storefront:frontend'] });
  };
  item('summary', 'Redesign the checkout summary panel', q1, 0, 'planned', 'change', 3);
  item('carts', 'Saved carts across devices', q1, 1, 'planned', 'change', 4);
  item('gift', 'Gift card redemption flow', q1, 2, 'planned', 'change', 7);
  item('express', 'One-tap express checkout', q1, 3, 'idea', 'change', null);
  item('recs', 'Personalised recommendations strip', q2, 0, 'idea', 'change', null);
  item('referral', 'Referral credit', q2, 1, 'idea', 'change', null);
  item('wishlist', 'Wishlist sharing', null, 0, 'idea', 'change', null);
}

// ---------- chat ----------

function seedChat(db: Db, workspaceId: string, weaverId: string): void {
  const channelId = id('channel:web');
  db.insert('channels', { id: channelId, workspaceId, kind: 'web', configJson: {}, status: 'active' });
  const threadId = id('thread:weaver');
  db.insert('channel_threads', { id: threadId, channelId, agentId: weaverId, humanLabel: 'captain', isPrimary: 1, createdAt: daysAgo(40), lastMessageAt: ago(2) });
  const msgs: Array<['inbound' | 'outbound', string, number]> = [
    ['inbound', 'Morning. Where are we on the checkout rework?', 190],
    ['outbound', 'Morning. Of the three changes in the rework: **LUM-3** (summary panel) is in review with its PR up, **LUM-4** (saved carts) has a plan waiting for you, and **LUM-7** (gift cards) is being revised after your note on partial redemption.\n\nNothing is blocked. The only thing I would look at first is the LUM-3 merge: CI is green and the layout holds down to 320px.', 188],
    ['inbound', 'Good. What was that latency spike on Friday?', 120],
    ['outbound', 'p95 checkout latency doubled at 14:10, right after the tax-rate lookup started calling the pricing service synchronously. I filed **LUM-6** to confirm it; the worker has a trace showing 380 ms waiting on `pricing.quote` against a 90 ms baseline. I will report back once it has tried the cached lookup behind a flag.', 118],
    ['inbound', 'Fine. And the app release?', 62],
    ['outbound', 'Pocket 4.2 is ready to submit. **LUM-22** has the commands and is waiting for your approval: iOS goes to review first, Android starts at a 10 percent rollout. **LUM-18** (biometric unlock) has a concern from my review: the fallback path has no test. I sent it back to the worker.', 60],
    ['inbound', 'Hire the data engineer for ledger, finance keeps asking for exports.', 14],
    ['outbound', 'Raised the hire request for a **Data Engineer** on Ledger API; it is in your decisions. Once approved I will give them **LUM-17** (per-tenant export quotas) first, since it shapes the export tables.', 12],
    ['inbound', 'Also, can you check on the CDN key rotation?', 4],
  ];
  for (const [i, [direction, body, minutes]] of msgs.entries()) {
    db.insert('thread_messages', { id: id(`msg:${i}`), threadId, direction, authorKind: direction === 'inbound' ? 'human' : 'agent', authorId: direction === 'inbound' ? 'captain' : weaverId, body, partsJson: [], deliveryStatus: 'delivered', attempts: 1, createdAt: ago(minutes) });
  }
}

// ---------- accounts ----------

function seedRuntimeAccounts(db: Db, workspaceId: string): void {
  const window = (kind: string, label: string, utilization: number, resetsInMin: number, scopeLabel: string | null = null): Record<string, unknown> => ({ kind, label, utilization, resetsAt: ago(-resetsInMin), scopeLabel });
  db.insert('runtime_accounts', { workspaceId, runtimeId: 'claude', billingType: 'subscription', planLabel: 'Max 20x', limitsAvailable: 1, limitsJson: [window('session', '5-hour', 42, 160), window('weekly_all', 'Weekly', 31, 3 * 1440), window('weekly_scoped', 'Weekly', 58, 3 * 1440, 'Opus')], note: null, capturedAt: ago(4) });
  db.insert('runtime_accounts', { workspaceId, runtimeId: 'codex', billingType: 'subscription', planLabel: 'Pro', limitsAvailable: 1, limitsJson: [window('session', '5-hour', 12, 230), window('weekly_all', 'Weekly', 20, 4 * 1440)], note: null, capturedAt: ago(9) });
  for (const runtimeId of ['claude', 'codex']) {
    db.insert('runtime_credentials', { workspaceId, runtimeId, present: 1, expiresAt: ago(-60 * 24 * 5), lastVerifiedAt: ago(8), needsLogin: 0, updatedAt: ago(8) });
  }
}

export const DEMO_SEED_NOW = DEMO_NOW_ISO;
void WEAVER_SCRIPT;
