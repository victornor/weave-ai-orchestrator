import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RuntimeModel } from '@weave-ai/runtime-sdk';
import { which } from '@weave-ai/runtime-sdk';

const pExecFile = promisify(execFile);

const LIST_MODELS_TIMEOUT_MS = 20_000;
const LIST_MODELS_MAX_BUFFER = 8 * 1024 * 1024;

/** Codex has no `--list-models`; this pinned set is used only when `debug models --bundled` cannot run. `efforts` omitted (unknown), never the four-value configSchema enum. */
const FALLBACK_IDS: Array<{ id: string; label: string; tier: string }> = [
  { id: 'gpt-5.6-codex', label: 'GPT-5.6 Codex', tier: 'frontier' },
  { id: 'gpt-5.6', label: 'GPT-5.6', tier: 'frontier' },
  { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', tier: 'frontier' },
  { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex mini', tier: 'fast' },
  { id: 'gpt-5', label: 'GPT-5', tier: 'balanced' },
  { id: 'gpt-5-mini', label: 'GPT-5 mini', tier: 'fast' },
  { id: 'o3', label: 'o3', tier: 'reasoning' },
  { id: 'o4-mini', label: 'o4-mini', tier: 'fast' },
];

export const FALLBACK_MODELS: RuntimeModel[] = FALLBACK_IDS.map((m) => ({
  id: m.id, label: m.label, provider: 'openai', source: 'static', tier: m.tier,
}));

function effortsFromLevels(levels: unknown): string[] | undefined {
  if (!Array.isArray(levels)) return undefined;
  const out: string[] = [];
  for (const item of levels) {
    if (typeof item === 'string' && item.length > 0) out.push(item);
    else if (item && typeof item === 'object' && typeof (item as { effort?: unknown }).effort === 'string') {
      const effort = (item as { effort: string }).effort;
      if (effort.length > 0) out.push(effort);
    }
  }
  return out;
}

/**
 * Parse `codex debug models --bundled` JSON (captured 2026-09-11, codex-cli 0.153.4).
 * Wire shape is `models[].slug` plus `models[].supported_reasoning_levels[].effort` —
 * not `supportedReasoningEfforts`.
 */
export function parseBundledModels(stdout: string): RuntimeModel[] {
  let data: unknown;
  try { data = JSON.parse(stdout); } catch { return []; }
  const models = data && typeof data === 'object' ? (data as { models?: unknown }).models : undefined;
  if (!Array.isArray(models)) return [];
  const out: RuntimeModel[] = [];
  for (const raw of models) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as { slug?: unknown; display_name?: unknown; supported_reasoning_levels?: unknown };
    if (typeof row.slug !== 'string' || row.slug.length === 0) continue;
    const model: RuntimeModel = {
      id: row.slug,
      label: typeof row.display_name === 'string' && row.display_name.length > 0 ? row.display_name : row.slug,
      provider: 'openai',
      source: 'detected',
    };
    const efforts = effortsFromLevels(row.supported_reasoning_levels);
    if (efforts) model.efforts = efforts;
    out.push(model);
  }
  return out;
}

/**
 * `binaryPath` is a test-only override: passing it (even `null`) skips `which('codex')`, so tests
 * never resolve or spawn the real installed CLI.
 */
export async function listModels(opts?: { binaryPath?: string | null }): Promise<RuntimeModel[]> {
  const binaryPath = opts && 'binaryPath' in opts ? (opts.binaryPath ?? null) : await which('codex');
  if (!binaryPath) return FALLBACK_MODELS.map((m) => ({ ...m }));
  try {
    const { stdout } = await pExecFile(binaryPath, ['debug', 'models', '--bundled'], {
      timeout: LIST_MODELS_TIMEOUT_MS,
      maxBuffer: LIST_MODELS_MAX_BUFFER,
    });
    const parsed = parseBundledModels(stdout);
    if (parsed.length > 0) return parsed;
  } catch { /* fall through */ }
  return FALLBACK_MODELS.map((m) => ({ ...m }));
}
