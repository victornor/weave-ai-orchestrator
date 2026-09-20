import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Agent, Role } from '@weave-ai/shared';
import type { RuntimeAdapter } from '@weave-ai/runtime-sdk';
import type { WorkspaceContext } from '../context.js';
import type { CoreServices } from '../api.js';
import { renderBrief, renderConductorInstructions, renderPlannerInstructions, renderSessionInstructions, renderWorkerInstructions } from '../prompts/index.js';

const MARKER = '.ac-render.json';

const WEAVER_SKILLS = ['weave-ai-weaver', 'weave-ai-hire', 'weave-ai-planning', 'weave-ai-briefing', 'weave-ai-knowledge', 'weave-ai-artifacts'];
const WORKER_SKILLS = ['weave-ai-worker', 'weave-ai-openspec', 'weave-ai-scout', 'weave-ai-knowledge', 'weave-ai-artifacts'];
/** VS-398: the planner reuses the weaver's own ticket-decomposition heuristics and, since VS-622, the artifact skill (it has `weave_artifact_kit` and the plan-scoped `weave_plan_artifact_put`); it has no tickets or knowledge-write tools, so none of the other skills apply. */
const PLANNER_SKILLS = ['weave-ai-planning', 'weave-ai-artifacts'];
/**
 * VS-620: a ticketless persistent session is a raw conversation the daemon only relays, not a worker
 * with a ticket, so it loads only the skills whose `skills/manifest.json` audience is `all` — never
 * the worker skills whose rules are the ticket protocol. A session that takes a ticket is rendered as
 * a worker (see `skillPostureOf`) and gets `WORKER_SKILLS` at that moment.
 */
const SESSION_SKILLS = ['weave-ai-knowledge', 'weave-ai-artifacts'];

/** Which skill set an agent's current posture loads (VS-620). */
type SkillPosture = 'weaver' | 'planner' | 'session' | 'worker';
const POSTURE_SKILLS: Record<SkillPosture, string[]> = {
  weaver: WEAVER_SKILLS,
  planner: PLANNER_SKILLS,
  session: SESSION_SKILLS,
  worker: WORKER_SKILLS,
};

/** The skill posture an agent is in now: a `session` is ticketless until it takes a ticket (VS-620). */
function skillPostureOf(agent: Pick<Agent, 'kind' | 'ticketId'>): SkillPosture {
  if (agent.kind === 'weaver') return 'weaver';
  if (agent.kind === 'planner') return 'planner';
  if (agent.kind === 'session' && !agent.ticketId) return 'session';
  return 'worker';
}

/** Skill packages shipped with the daemon, filtered to the ones this agent's posture loads. */
export function skillsFor(ctx: WorkspaceContext, agent: Pick<Agent, 'kind' | 'ticketId'>): Array<{ name: string; dir: string }> {
  const wanted = POSTURE_SKILLS[skillPostureOf(agent)];
  if (!ctx.skillsDir || !existsSync(ctx.skillsDir)) return [];
  let entries: string[] = [];
  try { entries = readdirSync(ctx.skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
  return entries.filter((n) => wanted.includes(n)).map((n) => ({ name: n, dir: join(ctx.skillsDir, n) }));
}

interface Marker { briefRevision: number; specRevision: number; roleRevision: number | null; runtimeId?: string; skillPosture?: SkillPosture; renderedAt: string }

function readMarker(home: string): Marker | null {
  try { return JSON.parse(readFileSync(join(home, MARKER), 'utf8')) as Marker; } catch { return null; }
}

function currentRevisions(ctx: WorkspaceContext, agent: Agent): Omit<Marker, 'renderedAt'> {
  const role = agent.roleId ? ctx.db.get<Role>('SELECT * FROM roles WHERE id = ?', [agent.roleId]) : null;
  return { briefRevision: agent.briefRevision, specRevision: role?.specRevision ?? 0, roleRevision: agent.roleRevision ?? null, runtimeId: agent.runtimeId, skillPosture: skillPostureOf(agent) };
}

/** Render AGENTS.md (+ brief.md, notes.md for workers) and install skills for the agent's runtime. */
export async function renderHome(ctx: WorkspaceContext, deps: () => CoreServices, agent: Agent, opts: { relaunchNote?: string | null } = {}): Promise<void> {
  const home = agent.homePath;
  mkdirSync(home, { recursive: true });
  const instructions = agent.kind === 'weaver'
    ? renderConductorInstructions(ctx, deps)
    : agent.kind === 'planner'
      ? renderPlannerInstructions(ctx, deps, agent)
      : agent.kind === 'session'
        ? renderSessionInstructions(ctx, deps, agent, opts)
        : renderWorkerInstructions(ctx, deps, agent, opts);
  writeFileSync(join(home, 'AGENTS.md'), instructions, 'utf8');
  // A ticketed session works exactly like a worker and gets the same brief.md/notes.md; a ticketless
  // one has neither — there is no ticket to brief it on yet.
  if (agent.kind === 'worker' || (agent.kind === 'session' && agent.ticketId)) {
    writeFileSync(join(home, 'brief.md'), renderBrief(ctx, deps, agent, opts), 'utf8');
    const notes = join(home, 'notes.md');
    if (!existsSync(notes)) writeFileSync(notes, `# Notes — ${agent.name}\n\nScratch space. Nothing here is injected anywhere; it is archived with the worker.\n`, 'utf8');
  }
  const runtime: RuntimeAdapter | undefined = ctx.registries.runtimes.get(agent.runtimeId);
  if (runtime) {
    try {
      await runtime.installInstructions({ path: home, kind: agent.kind }, { instructions, skills: skillsFor(ctx, agent) });
    } catch (e) {
      ctx.log('runtime').warn({ agentId: agent.id, err: String(e) }, 'installInstructions failed');
    }
  }
  const marker: Marker = { ...currentRevisions(ctx, agent), renderedAt: new Date().toISOString() };
  writeFileSync(join(home, MARKER), JSON.stringify(marker), 'utf8');
}

/** Re-render when the brief or the role spec moved since the last render (PLAN §7.3 step 1), when
 * the agent's resolved runtime no longer matches the runtime skills were last installed for (VS-189),
 * or when its skill posture changed (VS-620 — a session that took or finished a ticket) —
 * a marker written before a field existed has none and always counts as a mismatch, which
 * self-heals any home rendered before the fix on its very next turn. */
export async function ensureHomeCurrent(ctx: WorkspaceContext, deps: () => CoreServices, agent: Agent): Promise<{ rerendered: boolean; briefUpdated: boolean; charterChanged: boolean }> {
  const marker = readMarker(agent.homePath);
  const cur = currentRevisions(ctx, agent);
  const missing = !existsSync(join(agent.homePath, 'AGENTS.md'));
  const briefUpdated = !!marker && marker.briefRevision !== cur.briefRevision;
  const charterChanged = !!marker && marker.specRevision !== cur.specRevision;
  const runtimeChanged = !!marker && marker.runtimeId !== cur.runtimeId;
  const postureChanged = !!marker && marker.skillPosture !== cur.skillPosture;
  if (!missing && marker && !briefUpdated && !charterChanged && !runtimeChanged && !postureChanged) return { rerendered: false, briefUpdated: false, charterChanged: false };
  await renderHome(ctx, deps, agent);
  return { rerendered: true, briefUpdated, charterChanged };
}
