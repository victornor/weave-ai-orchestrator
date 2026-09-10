/**
 * Probe and one-shot transcribe via the Voxtype CLI. Never talks to `voxtype daemon`.
 * Tests inject a binary path; production looks up `voxtype` on PATH.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OcError } from '@agent-conductor/shared';
import { getLogger } from '@agent-conductor/core';

const log = getLogger('http', { component: 'voxtype' });

export interface VoxtypeModel {
  id: string;
  engine: string;
  installed: boolean;
}

export interface VoxtypeStatus {
  installed: boolean;
  models: VoxtypeModel[];
  error?: string;
}

export interface VoxtypeProbe {
  status(): Promise<VoxtypeStatus>;
  transcribe(audio: Buffer, model: string | undefined): Promise<string>;
}

export interface VoxtypeProbeOptions {
  binary?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export function parseVoxtypeModelsJson(raw: string): VoxtypeModel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const engines = (parsed as { engines?: unknown }).engines;
  if (!engines || typeof engines !== 'object') return [];
  const out: VoxtypeModel[] = [];
  for (const [engine, block] of Object.entries(engines as Record<string, unknown>)) {
    const models = block && typeof block === 'object' ? (block as { models?: unknown }).models : undefined;
    if (!Array.isArray(models)) continue;
    for (const m of models) {
      if (!m || typeof m !== 'object') continue;
      const name = (m as { name?: unknown }).name;
      if (typeof name !== 'string' || !name) continue;
      out.push({ id: name, engine, installed: Boolean((m as { installed?: unknown }).installed) });
    }
  }
  return out;
}

export function resolveVoxtypeModel(requested: string | undefined, status: VoxtypeStatus): string | undefined {
  const installed = status.models.filter((m) => m.installed);
  if (requested && installed.some((m) => m.id === requested)) return requested;
  return installed[0]?.id;
}

export function createVoxtypeProbe(opts: VoxtypeProbeOptions = {}): VoxtypeProbe {
  const binary = opts.binary ?? 'voxtype';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async status(): Promise<VoxtypeStatus> {
      try {
        const r = await runVoxtype(binary, ['info', 'models', '--json'], { timeoutMs });
        if (r.code !== 0) {
          return { installed: false, models: [], error: (r.stderr || `voxtype exited ${r.code}`).slice(0, 500) };
        }
        return { installed: true, models: parseVoxtypeModelsJson(r.stdout) };
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        const missing = 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
        return { installed: false, models: [], error: missing ? 'voxtype is not installed' : err.message.slice(0, 500) };
      }
    },

    async transcribe(audio: Buffer, model: string | undefined): Promise<string> {
      const dir = await mkdtemp(join(tmpdir(), 'ac-voxtype-'));
      const wav = join(dir, 'dictation.wav');
      try {
        await writeFile(wav, audio);
        const args = model ? ['--model', model, 'transcribe', wav] : ['transcribe', wav];
        const r = await runVoxtype(binary, args, { timeoutMs });
        if (r.code !== 0) {
          log.warn({ code: r.code, err: r.stderr.slice(0, 500) }, 'voxtype transcribe failed');
          throw new OcError('internal', `voxtype transcribe exited with ${r.code}`, { stderr: r.stderr.slice(0, 500) });
        }
        return r.stdout.trim();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

function runVoxtype(
  binary: string,
  args: string[],
  opts: { timeoutMs: number },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new OcError('internal', `voxtype timed out after ${opts.timeoutMs}ms`)));
    }, opts.timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
    child.on('error', (e) => finish(() => reject(e)));
    child.on('close', (code) => finish(() => resolve({ stdout, stderr, code })));
    child.stdin.end();
  });
}
