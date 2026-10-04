import { ago, daysAgo } from './clock.js';
import { demoId } from './ids.js';
import { eventRows, type SeedContext, type SeedResult } from './seed.js';
import { STOREFRONT_SCRIPT } from './script.js';

/** A second, smaller workspace — a design studio's marketing site — so the workspace switcher has somewhere to go. */
export function seedFernwood(c: SeedContext): SeedResult {
  const { db, root } = c;
  const id = demoId;
  const workspaceId = id('ws:fernwood');
  const wsOf = { workspaceId };
  db.insert('workspaces', { id: workspaceId, slug: 'fernwood', name: 'Fernwood Studio', ticketPrefix: 'FRN', ticketCounter: 6, status: 'active', rootPath: root, settingsJson: {}, createdAt: daysAgo(30), updatedAt: ago(20) });
  const projectId = id('project:site');
  db.insert('projects', { id: projectId, ...wsOf, slug: 'site', name: 'Marketing Site', gitUrl: 'git@git.fernwood.example:fernwood/site.git', defaultBranch: 'main', clonePath: `${root}/projects/site`, maxWorkers: 2, worktreeProvider: 'git', openspecEnabled: 1, policiesJson: { requireCi: false }, status: 'ready', lastFetchedAt: ago(30), createdAt: daysAgo(28), updatedAt: ago(30) });
  const roleId = 'site-web';
  db.insert('roles', { id: roleId, ...wsOf, projectId, slug: 'web', name: 'Web Designer', title: 'Builds the public site', charterSummary: 'Designs and builds the studio’s public pages.', scopeText: 'The marketing site repository.', responsibilitiesJson: ['Ship page changes through pull requests'], capabilitiesJson: [], rulesJson: [], permissionJson: { mode: 'auto' }, sessionPolicy: 'per_ticket', maxWorkers: 2, status: 'active', specRevision: 1, createdBy: 'weaver', createdAt: daysAgo(28), updatedAt: daysAgo(5), mcpServersJson: [] });
  const weaverId = id('fw:agent:weaver');
  db.insert('agents', { id: weaverId, ...wsOf, kind: 'weaver', name: 'Weaver', runtimeId: 'claude', status: 'active', homePath: '/srv/weave/fernwood/weaver', turnEpoch: 31, turnCount: 31, spawnedBy: 'system', briefRevision: 1, lastRunAt: ago(45), createdAt: daysAgo(30), updatedAt: ago(45) });

  const tickets: Record<string, string> = {};
  const rows: Array<[number, string, string, string, 'active' | 'running' | 'done' | null]> = [
    [1, 'done', 'task', 'Add the pricing page', 'done'],
    [2, 'in_progress', 'change', 'Rework the home page hero', 'running'],
    [3, 'in_review', 'change', 'Case study template', 'active'],
    [4, 'proposed', 'change', 'Newsletter sign-up form', 'active'],
    [5, 'todo', 'task', 'Compress hero images', null],
    [6, 'backlog', 'change', 'Dark theme for the case studies', null],
  ];
  for (const [n, status, kind, title, worker] of rows) {
    const tid = id(`fw:ticket:${n}`);
    tickets[`FRN-${n}`] = tid;
    const workerId = worker ? id(`fw:agent:worker:${n}`) : null;
    if (workerId) db.insert('agents', { id: workerId, ...wsOf, kind: 'worker', projectId, roleId, roleRevision: 1, ticketId: tid, name: `Web Designer #${500 + n}`, runtimeId: 'claude', status: worker, homePath: `/srv/weave/fernwood/workers/${workerId}`, spawnedBy: 'weaver', briefRevision: 1, turnEpoch: 2, turnCount: 2, lastRunAt: ago(30 + n * 11), createdAt: ago(3000 - n * 100), updatedAt: ago(30 + n * 11), retiredAt: worker === 'done' ? daysAgo(1) : null });
    db.insert('tickets', { id: tid, ...wsOf, projectId, number: n, identifier: `FRN-${n}`, kind, title, description: `${title}.`, summary: `${title}.`, status, priority: 'medium', autoMerge: 0, assigneeRoleId: roleId, workerId, assigneeHuman: 0, createdByKind: 'agent', createdById: weaverId, openspecChangeName: kind === 'change' ? `frn-${n}-change` : null, deliveryJson: status === 'in_review' ? { prUrl: 'https://github.com/fernwood/site/pull/12', prState: 'open' } : null, startedAt: status === 'todo' || status === 'backlog' ? null : ago(2000 - n * 90), completedAt: status === 'done' ? ago(1500) : null, createdAt: ago(3200 - n * 100), updatedAt: ago(60 + n * 20), interactiveSession: 0, mergeBypasses: 0, planArtifactRequired: 0 });
  }
  db.insert('decisions', { id: id('fw:decision:merge'), ...wsOf, ticketId: tickets['FRN-3'], projectId, kind: 'merge_approval', owner: 'human', askedByAgentId: id('fw:agent:worker:3'), title: 'Approve the merge for FRN-3: Case study template', context: 'Work product: https://github.com/fernwood/site/pull/12', optionsJson: [{ key: 'approve', label: 'Approve merge', recommended: true }, { key: 'changes', label: 'Request changes' }], allowFreeText: 1, status: 'open', weaverReviewStatus: 'unseen', correlationKey: 'merge_approval:fw3', createdAt: ago(90), inputsJson: [] });

  const runId = id('fw:run:live');
  db.insert('runs', { id: runId, ...wsOf, agentId: id('fw:agent:worker:2'), ticketId: tickets['FRN-2'], runtimeId: 'claude', model: 'claude-sonnet-5-5', status: 'running', turnEpoch: 1, cwd: '/srv/weave/fernwood/workers/2', startedAt: ago(7), usageJson: { inputTokens: 61000, outputTokens: 4200, basis: 'per_turn' }, costCents: 31, lastEventAt: ago(0.5), createdAt: ago(8), wakeupIdsJson: [], liveness: 'active', lastProgressAt: ago(0.5) });
  eventRows(db, runId, STOREFRONT_SCRIPT, 7, 5);

  const channelId = id('fw:channel:web');
  db.insert('channels', { id: channelId, ...wsOf, kind: 'web', configJson: {}, status: 'active' });
  const threadId = id('fw:thread:weaver');
  db.insert('channel_threads', { id: threadId, channelId, agentId: weaverId, humanLabel: 'captain', isPrimary: 1, createdAt: daysAgo(30), lastMessageAt: ago(100) });
  db.insert('thread_messages', { id: id('fw:msg:1'), threadId, direction: 'inbound', authorKind: 'human', authorId: 'captain', body: 'How is the case study template coming along?', partsJson: [], deliveryStatus: 'delivered', attempts: 1, createdAt: ago(110) });
  db.insert('thread_messages', { id: id('fw:msg:2'), threadId, direction: 'outbound', authorKind: 'agent', authorId: weaverId, body: '**FRN-3** is in review: the template renders all four case studies and the PR is up. **FRN-2** (the hero) is still in progress.', partsJson: [], deliveryStatus: 'delivered', attempts: 1, createdAt: ago(100) });
  return { workspaceId, slug: 'fernwood', projectIds: { site: projectId }, tickets, weaverId };
}
