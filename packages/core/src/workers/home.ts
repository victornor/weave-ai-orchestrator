import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Agent, Role } from '@openconductor/shared';
import type { RuntimeAdapter } from '@openconductor/runtime-sdk';
import type { WorkspaceContext } from '../context.js';
import type { CoreServices } from '../api.js';
import { renderBrief, renderConductorInstructions, renderWorkerInstructions } from '../prompts/index.js';

const MARKER = '.oc-render.json';

const CONDUCTOR_SKILLS = ['openconductor-conductor', 'openconductor-hire', 'openconductor-planning', 'openconductor-briefing', 'openconductor-knowledge'];
const WORKER_SKILLS = ['openconductor-worker', 'openconductor-openspec', 'openconductor-scout', 'openconductor-knowledge'];

/** Skill packages shipped with the daemon, filtered to the ones this agent kind loads. */
export function skillsFor(ctx: WorkspaceContext, kind: 'conductor' | 'worker'): Array<{ name: string; dir: string }> {
  const wanted = kind === 'conductor' ? CONDUCTOR_SKILLS : WORKER_SKILLS;
  if (!ctx.skillsDir || !existsSync(ctx.skillsDir)) return [];
  let entries: string[] = [];
  try { entries = readdirSync(ctx.skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
  return entries.filter((n) => wanted.includes(n)).map((n) => ({ name: n, dir: join(ctx.skillsDir, n) }));
}

interface Marker { briefRevision: number; specRevision: number; roleRevision: number | null; renderedAt: string }

function readMarker(home: string): Marker | null {
  try { return JSON.parse(readFileSync(join(home, MARKER), 'utf8')) as Marker; } catch { return null; }
}

function currentRevisions(ctx: WorkspaceContext, agent: Agent): Omit<Marker, 'renderedAt'> {
  const role = agent.roleId ? ctx.db.get<Role>('SELECT * FROM roles WHERE id = ?', [agent.roleId]) : null;
  return { briefRevision: agent.briefRevision, specRevision: role?.specRevision ?? 0, roleRevision: agent.roleRevision ?? null };
}

/** Render AGENTS.md (+ brief.md, notes.md for workers) and install skills for the agent's runtime. */
export async function renderHome(ctx: WorkspaceContext, deps: () => CoreServices, agent: Agent, opts: { relaunchNote?: string | null } = {}): Promise<void> {
  const home = agent.homePath;
  mkdirSync(home, { recursive: true });
  const instructions = agent.kind === 'conductor'
    ? renderConductorInstructions(ctx, deps)
    : renderWorkerInstructions(ctx, deps, agent, opts);
  writeFileSync(join(home, 'AGENTS.md'), instructions, 'utf8');
  if (agent.kind === 'worker') {
    writeFileSync(join(home, 'brief.md'), renderBrief(ctx, deps, agent, opts), 'utf8');
    const notes = join(home, 'notes.md');
    if (!existsSync(notes)) writeFileSync(notes, `# Notes — ${agent.name}\n\nScratch space. Nothing here is injected anywhere; it is archived with the worker.\n`, 'utf8');
  }
  const runtime: RuntimeAdapter | undefined = ctx.registries.runtimes.get(agent.runtimeId);
  if (runtime) {
    try {
      await runtime.installInstructions({ path: home, kind: agent.kind }, { instructions, skills: skillsFor(ctx, agent.kind) });
    } catch (e) {
      ctx.log('runtime').warn({ agentId: agent.id, err: String(e) }, 'installInstructions failed');
    }
  }
  const marker: Marker = { ...currentRevisions(ctx, agent), renderedAt: new Date().toISOString() };
  writeFileSync(join(home, MARKER), JSON.stringify(marker), 'utf8');
}

/** Re-render only when the brief or the role spec moved since the last render (PLAN §7.3 step 1). */
export async function ensureHomeCurrent(ctx: WorkspaceContext, deps: () => CoreServices, agent: Agent): Promise<{ rerendered: boolean; briefUpdated: boolean; charterChanged: boolean }> {
  const marker = readMarker(agent.homePath);
  const cur = currentRevisions(ctx, agent);
  const missing = !existsSync(join(agent.homePath, 'AGENTS.md'));
  const briefUpdated = !!marker && marker.briefRevision !== cur.briefRevision;
  const charterChanged = !!marker && marker.specRevision !== cur.specRevision;
  if (!missing && marker && !briefUpdated && !charterChanged) return { rerendered: false, briefUpdated: false, charterChanged: false };
  await renderHome(ctx, deps, agent);
  return { rerendered: true, briefUpdated, charterChanged };
}
