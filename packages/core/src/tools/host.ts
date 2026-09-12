/**
 * Host tool detection (PLAN §20 `weave doctor`). The daemon reports these on `/api/health` so a remote
 * `weave doctor` can tell what is missing on the daemon host rather than on the laptop.
 */
import { sh } from '../util/exec.js';
import { openspecBin } from '../openspec/cli.js';

export const HOST_TOOL_IDS = ['git', 'gh', 'openspec', 'wt'] as const;
export type HostToolId = (typeof HOST_TOOL_IDS)[number];

export interface HostTool {
  id: HostToolId;
  available: boolean;
  version: string | null;
  /** What breaks without it. */
  need: 'required' | 'recommended';
  purpose: string;
}

const SPEC: Record<HostToolId, { bin: () => string; args: string[]; need: HostTool['need']; purpose: string }> = {
  git: { bin: () => 'git', args: ['--version'], need: 'required', purpose: 'clones, worktrees, merges' },
  gh: { bin: () => 'gh', args: ['--version'], need: 'recommended', purpose: 'pull-request delivery (deliveryMode: pr)' },
  openspec: { bin: () => openspecBin(), args: ['--version'], need: 'recommended', purpose: 'change tickets: proposal validation, apply, archive, Spec Explorer' },
  wt: { bin: () => 'wt', args: ['--version'], need: 'recommended', purpose: 'worktrunk worktrees (falls back to plain git worktree)' },
};

export async function detectHostTool(id: HostToolId): Promise<HostTool> {
  const spec = SPEC[id];
  const r = await sh(spec.bin(), spec.args, { cwd: process.cwd(), timeoutMs: 10_000, env: { NO_COLOR: '1' } });
  const first = r.stdout.trim().split('\n')[0]?.trim() ?? '';
  const version = r.ok ? (first.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? first) : null;
  return { id, available: r.ok, version, need: spec.need, purpose: spec.purpose };
}

export async function detectHostTools(): Promise<Record<HostToolId, HostTool>> {
  const entries = await Promise.all(HOST_TOOL_IDS.map(async (id) => [id, await detectHostTool(id)] as const));
  return Object.fromEntries(entries) as Record<HostToolId, HostTool>;
}

let cached: { at: number; value: Record<HostToolId, HostTool> } | null = null;

/** Detection cached for a minute: `/api/health` is polled, and spawning four processes per poll is silly. */
export async function detectHostToolsCached(maxAgeMs = 60_000): Promise<Record<HostToolId, HostTool>> {
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.value;
  const value = await detectHostTools();
  cached = { at: Date.now(), value };
  return value;
}
