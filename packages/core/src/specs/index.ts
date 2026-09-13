/**
 * SpecsService (PLAN §12.5): the per-project spec index behind the Spec Explorer, the `weave_spec_*` tools and
 * the shared knowledge search. OpenSpec leaves a spec document behind for nearly every feature, so specs are
 * treated as project knowledge: capabilities and their requirements come from the primary clone on the
 * default branch, archived changes are read from `openspec/changes/archive/`, and active changes are read
 * from the owning worker's worktree. The index never writes into a repo.
 *
 * Indexing is resilient by design: no `openspec` binary or no `openspec/` directory means "nothing to index",
 * never an error, because most of the daemon must keep working on projects that do not use OpenSpec.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { newId, nowIso } from '@weave-ai/db';
import { OcError } from '@weave-ai/shared';
import type { Actor, CapabilityRequirement, CoreServices, PendingChange, RequirementDelta, SpecChangeSummary, SpecsService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import * as cli from '../openspec/cli.js';
import { projectRow } from '../openspec/index.js';
import { ftsQuery } from '../search/ftsQuery.js';

export { ftsQuery };

const SYSTEM: Actor = { kind: 'system', id: null };
export type DeltaKind = 'added' | 'modified' | 'removed' | 'renamed';

export interface ChangeArtifacts { proposal: string | null; design: string | null; tasks: string | null; specs: Record<string, string> }
export interface ChangeRecord {
  changeName: string; state: 'active' | 'archived'; ticketId: string | null; archivedAs: string | null;
  archivedAt: string | null; createdAt: string | null; artifacts: ChangeArtifacts;
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const readIf = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf8') : null);
/** Requirement names are matched across files, so only case and run-together whitespace are forgiven. */
const normalizeName = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
const dirs = (p: string): string[] => (existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);

/**
 * The delta kind a change applies to a capability, from the `## ADDED|MODIFIED|REMOVED|RENAMED Requirements`
 * headers of its delta spec. The first header in the file wins when several appear.
 */
export function deltaKindOf(body: string): DeltaKind {
  const m = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\b/im.exec(body);
  const kind = m?.[1]?.toLowerCase();
  return kind === 'added' || kind === 'modified' || kind === 'removed' || kind === 'renamed' ? kind : 'modified';
}

const DELTA_KINDS: Record<string, DeltaKind> = { added: 'added', modified: 'modified', removed: 'removed', renamed: 'renamed' };

export interface DeltaScenario { text: string; steps: Array<{ word: string; text: string }> }
/** One `### Requirement:` of a delta spec, under the `## <KIND> Requirements` section it appears in. */
export interface DeltaRequirement { kind: DeltaKind; name: string; text: string; scenarios: DeltaScenario[] }

/**
 * Every requirement a delta spec touches, in file order. A delta spec groups its requirements under
 * `## ADDED|MODIFIED|REMOVED|RENAMED Requirements` headers; any other `##` heading (`## Purpose`) ends the
 * group. A RENAMED group names its requirements in `- FROM:` / `- TO:` list items rather than in headers,
 * and both sides are reported: the old name is what the capability still carries, the new one is arriving.
 *
 * Text and scenarios are carried along because a requirement an active change only ADDs is not in the
 * capability's own spec yet — the delta spec is the only place its wording exists.
 */
export function parseDeltaRequirements(body: string): DeltaRequirement[] {
  const out: DeltaRequirement[] = [];
  let kind: DeltaKind | null = null;
  let current: DeltaRequirement | null = null;
  let scenario: DeltaScenario | null = null;
  const start = (k: DeltaKind, name: string): DeltaRequirement => {
    const r: DeltaRequirement = { kind: k, name: name.trim(), text: '', scenarios: [] };
    out.push(r);
    scenario = null;
    return r;
  };
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    const requirement = /^###\s+Requirement:\s*(.+)$/.exec(line);
    if (requirement) { current = kind ? start(kind, requirement[1]!) : null; scenario = null; continue; }
    const scen = /^####\s+Scenario:\s*(.+)$/.exec(line);
    if (scen && current) { scenario = { text: scen[1]!.trim(), steps: [] }; current.scenarios.push(scenario); continue; }
    const section = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\b/i.exec(line);
    if (section) { kind = DELTA_KINDS[section[1]!.toLowerCase()]!; current = null; scenario = null; continue; }
    if (/^#{1,4}\s/.test(line)) { kind = null; current = null; scenario = null; continue; }
    if (kind === 'renamed') {
      const side = /^\s*[-*]\s*(?:FROM|TO):\s*`?\s*###\s+Requirement:\s*(.+?)\s*`?\s*$/i.exec(line);
      if (side) { start('renamed', side[1]!); current = null; continue; }
    }
    if (scenario) {
      const step = /^\s*[-*]\s*\*\*([A-Za-z]+)\*\*\s*(.*)$/.exec(line);
      if (step) scenario.steps.push({ word: step[1]!.toUpperCase(), text: step[2]!.trim() });
      continue;
    }
    if (current) current.text += current.text.length ? `\n${line}` : line;
  }
  return out.filter((r) => r.name.length > 0).map((r) => ({ ...r, text: r.text.trim() }));
}

/** `- [x] text` / `- [ ] text` lines of a change's tasks.md, in file order. Anything else in the file is prose. */
export function parseTasks(md: string | null): Array<{ text: string; done: boolean }> {
  const out: Array<{ text: string; done: boolean }> = [];
  for (const line of (md ?? '').split('\n')) {
    const m = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/.exec(line);
    if (m) out.push({ text: (m[2] ?? '').trim(), done: (m[1] ?? '').toLowerCase() === 'x' });
  }
  return out;
}

/** proposal.md / design.md / tasks.md plus every `specs/**\/spec.md` delta, keyed by capability path. */
export function readChangeDir(dir: string): ChangeArtifacts {
  const specs: Record<string, string> = {};
  const specsRoot = join(dir, 'specs');
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'spec.md') {
        const capability = relative(specsRoot, d).split(/[\\/]/).filter(Boolean).join('/');
        if (capability) specs[capability] = readFileSync(p, 'utf8');
      }
    }
  };
  walk(specsRoot);
  return { proposal: readIf(join(dir, 'proposal.md')), design: readIf(join(dir, 'design.md')), tasks: readIf(join(dir, 'tasks.md')), specs };
}

/** `openspec/changes/archive/YYYY-MM-DD-<name>` directories on the default branch. */
export function readArchivedChanges(clonePath: string): ChangeRecord[] {
  const root = join(clonePath, 'openspec', 'changes', 'archive');
  return dirs(root).map((name) => {
    const m = /^(\d{4}-\d{2}-\d{2})-(.+)$/.exec(name);
    return {
      changeName: m?.[2] ?? name,
      state: 'archived' as const,
      ticketId: null,
      archivedAs: name,
      archivedAt: m?.[1] ? `${m[1]}T00:00:00.000Z` : null,
      createdAt: null,
      artifacts: readChangeDir(join(root, name)),
    };
  });
}

function artifactText(a: ChangeArtifacts): string {
  return [a.proposal, a.design, a.tasks, ...Object.values(a.specs)].filter((s): s is string => typeof s === 'string' && s.length > 0).join('\n\n');
}

interface CapabilityRow { id: string; capability: string; title: string | null; requirementCount: number; body: string; lastArchivedChange: string | null; updatedAt: string }
interface ChangeRow { id: string; changeName: string; state: string; ticketId: string | null; archivedAs: string | null; archivedAt: string | null; createdAt: string | null; artifacts: ChangeArtifacts; updatedAt: string }

export function createSpecsService(ctx: WorkspaceContext, _deps: () => CoreServices): SpecsService {
  const log = ctx.log('openspec');
  const db = ctx.db;

  const project = (projectId: string): { id: string; clonePath: string } => {
    const p = projectRow(db, projectId);
    if (!p) throw new OcError('not_found', `project ${projectId} not found`);
    return p;
  };
  const ticketFor = (changeName: string): string | null =>
    db.get<{ id: string }>('SELECT id FROM tickets WHERE workspace_id = ? AND openspec_change_name = ? ORDER BY created_at DESC LIMIT 1', [ctx.workspaceId, changeName])?.id ?? null;
  const changesOf = (projectId: string, state?: string): ChangeRow[] =>
    db.all<ChangeRow>(`SELECT id, change_name, state, ticket_id, archived_as, archived_at, created_at, artifacts_json, updated_at FROM spec_changes WHERE project_id = ?${state ? ' AND state = ?' : ''} ORDER BY archived_at DESC, change_name`, state ? [projectId, state] : [projectId]);
  const capsOfChange = (changeId: string): Array<{ capability: string; deltaKind: string }> =>
    db.all<{ capability: string; deltaKind: string }>('SELECT capability, delta_kind FROM spec_change_capabilities WHERE change_id = ? ORDER BY capability', [changeId]);
  const identifierOf = (ticketId: string | null): string | null =>
    (ticketId ? db.get<{ identifier: string }>('SELECT identifier FROM tickets WHERE id = ?', [ticketId])?.identifier ?? null : null);
  /**
   * A row stores the change folder verbatim in `artifacts_json`; the UI, the CLI and `weave_spec_change_get`
   * all want the parsed change, so the parsing happens once here rather than in each client.
   */
  const summaryOf = (c: ChangeRow): SpecChangeSummary => {
    const tasks = parseTasks(c.artifacts.tasks);
    return {
      id: c.id, changeName: c.changeName, state: c.state === 'active' ? 'active' : 'archived', ticketId: c.ticketId,
      ticketIdentifier: identifierOf(c.ticketId), archivedAs: c.archivedAs, archivedAt: c.archivedAt,
      createdAt: c.createdAt, updatedAt: c.updatedAt, capabilities: capsOfChange(c.id),
      taskProgress: { done: tasks.filter((t) => t.done).length, total: tasks.length },
    };
  };

  return {
    async index(projectId) {
      const p = project(projectId);
      projectId = p.id;
      const openspecDir = join(p.clonePath, 'openspec');
      if (!existsSync(openspecDir)) { log.info({ projectId, clonePath: p.clonePath }, 'no openspec/ directory; nothing to index'); return { capabilities: 0, changes: 0 }; }

      const o = { cwd: p.clonePath, root: p.clonePath };
      let entries: cli.SpecListEntry[];
      try { entries = await cli.listSpecs(o); }
      catch (e) {
        if (e instanceof OcError && e.code === 'openspec_not_found') { log.warn({ projectId }, 'openspec binary missing; skipping the spec index'); return { capabilities: 0, changes: 0 }; }
        throw e;
      }

      // ---- capabilities (primary clone, default branch)
      const caps: Array<{ entry: cli.SpecListEntry; doc: cli.SpecDoc; body: string; path: string }> = [];
      for (const entry of entries) {
        let doc: cli.SpecDoc;
        try { doc = await cli.showSpec(o, entry.id); }
        catch (e) {
          if (e instanceof OcError && e.code === 'openspec_not_found') { log.warn({ projectId }, 'openspec binary vanished mid-index'); return { capabilities: 0, changes: 0 }; }
          log.warn({ err: e, capability: entry.id }, 'openspec show failed; skipping the capability');
          continue;
        }
        const rel = entry.path ?? doc.path ?? join('openspec', 'specs', entry.id, 'spec.md');
        const abs = isAbsolute(rel) ? rel : join(p.clonePath, rel);
        caps.push({ entry, doc, body: readIf(abs) ?? '', path: isAbsolute(rel) ? relative(p.clonePath, rel) : rel });
      }

      // ---- changes: archived from the clone, active from the workers' worktrees
      const changes: ChangeRecord[] = readArchivedChanges(p.clonePath).map((c) => ({ ...c, ticketId: ticketFor(c.changeName) }));
      for (const w of db.all<{ worktreePath: string; ticketId: string; changeName: string }>(
        `SELECT a.worktree_path AS worktree_path, t.id AS ticket_id, t.openspec_change_name AS change_name
           FROM agents a JOIN tickets t ON t.id = a.ticket_id
          WHERE a.workspace_id = ? AND a.kind = 'worker' AND a.status <> 'retired' AND a.project_id = ?
            AND a.worktree_path IS NOT NULL AND t.openspec_change_name IS NOT NULL`, [ctx.workspaceId, projectId])) {
        if (!existsSync(w.worktreePath)) continue;
        const dir = join(w.worktreePath, 'openspec', 'changes', w.changeName);
        try { await cli.statusAll({ cwd: w.worktreePath, root: w.worktreePath }); }
        catch (e) { log.debug({ err: e, worktree: w.worktreePath }, 'openspec status in the worktree failed'); }
        if (!existsSync(dir)) continue;
        changes.push({ changeName: w.changeName, state: 'active', ticketId: w.ticketId, archivedAs: null, archivedAt: null, createdAt: null, artifacts: readChangeDir(dir) });
      }

      const lastArchivedFor = new Map<string, { name: string; at: string }>();
      for (const c of changes) {
        if (c.state !== 'archived') continue;
        for (const capability of Object.keys(c.artifacts.specs)) {
          const prev = lastArchivedFor.get(capability);
          if (!prev || (c.archivedAt ?? '') >= prev.at) lastArchivedFor.set(capability, { name: c.changeName, at: c.archivedAt ?? '' });
        }
      }

      const ts = nowIso();
      db.transaction(() => {
        // capabilities: upsert (ids are stable so requirements and UI links survive a reindex)
        const keep = new Set<string>();
        for (const c of caps) {
          const existing = db.get<{ id: string }>('SELECT id FROM spec_capabilities WHERE project_id = ? AND capability = ?', [projectId, c.entry.id]);
          const row = {
            title: c.doc.title, requirementCount: c.doc.requirementCount || c.doc.requirements.length, bodyHash: sha256(c.body),
            body: c.body, path: c.path, lastArchivedChange: lastArchivedFor.get(c.entry.id)?.name ?? null, updatedAt: ts,
          };
          const id = existing?.id ?? newId();
          if (existing) db.update('spec_capabilities', id, row);
          else db.insert('spec_capabilities', { id, projectId, capability: c.entry.id, ...row });
          keep.add(id);
          db.run('DELETE FROM spec_requirements WHERE capability_id = ?', [id]);
          for (const r of c.doc.requirements) db.insert('spec_requirements', { id: newId(), capabilityId: id, name: r.name, text: r.text, scenariosJson: r.scenarios });
        }
        for (const stale of db.all<{ id: string }>('SELECT id FROM spec_capabilities WHERE project_id = ?', [projectId])) {
          if (keep.has(stale.id)) continue;
          db.run('DELETE FROM spec_requirements WHERE capability_id = ?', [stale.id]);
          db.run('DELETE FROM spec_capabilities WHERE id = ?', [stale.id]);
        }

        // changes: full replace, they are cheap and their identity is (name, state)
        db.run('DELETE FROM spec_change_capabilities WHERE change_id IN (SELECT id FROM spec_changes WHERE project_id = ?)', [projectId]);
        db.run('DELETE FROM spec_changes WHERE project_id = ?', [projectId]);
        for (const c of changes) {
          const id = newId();
          db.insert('spec_changes', {
            id, projectId, changeName: c.changeName, state: c.state, ticketId: c.ticketId, archivedAs: c.archivedAs,
            createdAt: c.createdAt, archivedAt: c.archivedAt, artifactsJson: c.artifacts, updatedAt: ts,
          });
          const seen = new Set<string>();
          for (const [capability, body] of Object.entries(c.artifacts.specs)) {
            if (seen.has(capability)) continue;
            seen.add(capability);
            db.insert('spec_change_capabilities', { changeId: id, capability, deltaKind: deltaKindOf(body) });
          }
        }

        // full-text rows for this project; kind='knowledge' belongs to the knowledge base and is left alone
        db.run("DELETE FROM knowledge_search WHERE kind IN ('spec','change') AND project_id = ?", [projectId]);
        for (const c of caps) {
          db.insert('knowledge_search', { kind: 'spec', projectId, ref: `spec:${c.entry.id}`, title: c.doc.title ?? c.entry.id, body: c.body || c.doc.overview || '' });
          for (const r of c.doc.requirements) db.insert('knowledge_search', { kind: 'spec', projectId, ref: `spec:${c.entry.id}#${r.name}`, title: `${c.doc.title ?? c.entry.id}: ${r.name}`, body: r.text });
        }
        for (const c of changes) db.insert('knowledge_search', { kind: 'change', projectId, ref: `change:${c.changeName}`, title: c.changeName, body: artifactText(c.artifacts) });
      });

      const counts = { capabilities: caps.length, changes: changes.length };
      recordActivity(db, ctx.workspaceId, SYSTEM, 'spec.indexed', 'project', projectId, counts);
      ctx.events.emit('spec.indexed', 'project', projectId, counts);
      log.debug({ projectId, ...counts }, 'spec index rebuilt');
      return counts;
    },

    listCapabilities(projectId) {
      projectId = project(projectId).id;
      const pending = new Map<string, PendingChange[]>();
      for (const r of db.all<{ capability: string; changeName: string; ticketId: string | null; ticketIdentifier: string | null; deltaKind: string }>(
        `SELECT scc.capability, sc.change_name, sc.ticket_id, t.identifier AS ticket_identifier, scc.delta_kind
           FROM spec_change_capabilities scc JOIN spec_changes sc ON sc.id = scc.change_id
           LEFT JOIN tickets t ON t.id = sc.ticket_id
          WHERE sc.project_id = ? AND sc.state = 'active' ORDER BY sc.change_name`, [projectId])) {
        const list = pending.get(r.capability) ?? [];
        list.push({ changeName: r.changeName, ticketId: r.ticketId, ticketIdentifier: r.ticketIdentifier, deltaKind: r.deltaKind });
        pending.set(r.capability, list);
      }
      return db.all<CapabilityRow>(
        `SELECT c.id, c.capability, c.title, c.requirement_count, c.last_archived_change, c.updated_at
           FROM spec_capabilities c WHERE c.project_id = ? ORDER BY c.capability`, [projectId])
        .map((r) => ({
          id: r.id, capability: r.capability, title: r.title, requirementCount: r.requirementCount,
          lastArchivedChange: r.lastArchivedChange, pendingChanges: pending.get(r.capability) ?? [], updatedAt: r.updatedAt,
        }));
    },

    getCapability(projectId, capability) {
      projectId = project(projectId).id;
      const row = db.get<CapabilityRow>('SELECT id, capability, title, requirement_count, body, last_archived_change, updated_at FROM spec_capabilities WHERE project_id = ? AND capability = ?', [projectId, capability]);
      if (!row) throw new OcError('not_found', `capability ${capability} is not indexed for this project`);
      const requirements: CapabilityRequirement[] = db.all<{ name: string; text: string; scenarios: unknown }>('SELECT name, text, scenarios_json FROM spec_requirements WHERE capability_id = ? ORDER BY rowid', [row.id])
        .map((r) => ({ name: r.name, text: r.text, scenarios: Array.isArray(r.scenarios) ? r.scenarios : [], delta: null }));
      const linked = db.all<{ changeName: string; ticketId: string | null; deltaKind: string; state: string; archivedAs: string | null; archivedAt: string | null; artifacts: ChangeArtifacts }>(
        `SELECT sc.change_name, sc.ticket_id, scc.delta_kind, sc.state, sc.archived_as, sc.archived_at, sc.artifacts_json
           FROM spec_change_capabilities scc JOIN spec_changes sc ON sc.id = scc.change_id
          WHERE sc.project_id = ? AND scc.capability = ? ORDER BY sc.archived_at DESC, sc.change_name`, [projectId, capability]);

      // Pending deltas are read inline off the requirement, so an active change's delta spec is matched
      // requirement by requirement against the capability. Archived changes are history, never pending.
      const at = new Map(requirements.map((r, i) => [normalizeName(r.name), i]));
      for (const l of linked) {
        if (l.state !== 'active') continue;
        const deltaSpec = l.artifacts?.specs?.[capability];
        if (!deltaSpec) continue;
        const ticketIdentifier = identifierOf(l.ticketId);
        for (const d of parseDeltaRequirements(deltaSpec)) {
          const delta = { kind: d.kind.toUpperCase() as RequirementDelta['kind'], changeName: l.changeName, ticketIdentifier, state: 'pending' as const };
          const known = at.get(normalizeName(d.name));
          if (known !== undefined) { requirements[known]!.delta ??= delta; continue; }
          if (d.kind === 'removed' || d.kind === 'modified') continue;   // the capability never had it; nothing to mark
          at.set(normalizeName(d.name), requirements.length);
          requirements.push({ name: d.name, text: d.text, scenarios: d.scenarios, delta });
        }
      }

      return {
        id: row.id, capability: row.capability, title: row.title, body: row.body, requirements,
        pending: linked.filter((l) => l.state === 'active').map((l) => ({ changeName: l.changeName, ticketId: l.ticketId, ticketIdentifier: identifierOf(l.ticketId), deltaKind: l.deltaKind })),
        history: linked.filter((l) => l.state === 'archived').map((l) => ({ changeName: l.changeName, ticketId: l.ticketId, ticketIdentifier: identifierOf(l.ticketId), state: l.state, archivedAs: l.archivedAs, archivedAt: l.archivedAt })),
      };
    },

    listChanges(projectId, state) {
      projectId = project(projectId).id;
      return changesOf(projectId, state).map(summaryOf);
    },

    getChange(projectId, changeName) {
      projectId = project(projectId).id;
      const rows = changesOf(projectId).filter((c) => c.changeName === changeName);
      const row = rows.find((c) => c.state === 'active') ?? rows[0];
      if (!row) throw new OcError('not_found', `change ${changeName} is not indexed for this project`);
      const a = row.artifacts;
      return {
        ...summaryOf(row),
        proposal: a.proposal, design: a.design, tasks: parseTasks(a.tasks),
        deltas: Object.entries(a.specs).map(([capability, body]) => ({ capability, kind: deltaKindOf(body), body })),
      };
    },

    graph(projectId) {
      projectId = project(projectId).id;
      const nodes: Array<{ id: string; kind: 'capability' | 'change' | 'ticket'; label: string; status?: string }> = [];
      const edges: Array<{ from: string; to: string; kind: 'touches' | 'belongs_to' }> = [];
      for (const c of db.all<{ capability: string; requirementCount: number }>('SELECT capability, requirement_count FROM spec_capabilities WHERE project_id = ? ORDER BY capability', [projectId])) {
        nodes.push({ id: `capability:${c.capability}`, kind: 'capability', label: c.capability, status: `${c.requirementCount} requirements` });
      }
      const tickets = new Set<string>();
      for (const c of changesOf(projectId)) {
        const from = `change:${c.changeName}`;
        nodes.push({ id: from, kind: 'change', label: c.changeName, status: c.state });
        for (const cap of capsOfChange(c.id)) edges.push({ from, to: `capability:${cap.capability}`, kind: 'touches' });
        if (!c.ticketId || tickets.has(c.ticketId)) { if (c.ticketId) edges.push({ from, to: `ticket:${c.ticketId}`, kind: 'belongs_to' }); continue; }
        tickets.add(c.ticketId);
        const t = db.get<{ identifier: string; title: string; status: string }>('SELECT identifier, title, status FROM tickets WHERE id = ?', [c.ticketId]);
        nodes.push({ id: `ticket:${c.ticketId}`, kind: 'ticket', label: t ? `${t.identifier} ${t.title}` : c.ticketId, status: t?.status });
        edges.push({ from, to: `ticket:${c.ticketId}`, kind: 'belongs_to' });
      }
      return { nodes, edges };
    },

    search(query, projectId) {
      const match = ftsQuery(query);
      if (!match.length) return [];
      const sql = `SELECT kind, project_id, ref, title, snippet(knowledge_search, 4, '[', ']', '…', 16) AS snippet
                     FROM knowledge_search WHERE knowledge_search MATCH ? AND kind IN ('spec','change')${projectId ? ' AND project_id = ?' : ''}
                     ORDER BY rank LIMIT 50`;
      const rows = db.all<{ kind: string; projectId: string; ref: string; title: string; snippet: string }>(sql, projectId ? [match, projectId] : [match]);
      return rows.map((r) => ({ kind: r.kind, projectId: r.projectId, ref: r.ref, title: r.title, snippet: r.snippet }));
    },
  };
}
