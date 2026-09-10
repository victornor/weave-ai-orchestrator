import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RuntimeModel } from '@agent-conductor/runtime-sdk';
import { which } from '@agent-conductor/runtime-sdk';

const pExecFile = promisify(execFile);

/** Load-bearing against `handleModelsList`'s interactive-login prompt hanging with no stored credential (see design.md). */
const LIST_MODELS_TIMEOUT_MS = 20_000;
const LIST_MODELS_MAX_BUFFER = 1024 * 1024;
const CACHE_TTL_MS = 15 * 60_000;
const LOG_EXCERPT_MAX = 300;

const FAMILIES: Record<string, { name: string; provider: string }> = {
  grok: { name: 'Grok', provider: 'xai' },
  gpt: { name: 'GPT', provider: 'openai' },
  composer: { name: 'Composer', provider: 'cursor' },
  sol: { name: 'Sol', provider: 'cursor' },
  auto: { name: 'Auto', provider: 'cursor' },
};

const VARIANTS: Record<string, string> = {
  high: 'High', xhigh: 'XHigh', low: 'Low', fast: 'Fast', thinking: 'Thinking',
};

function titleCase(s: string): string { return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1); }

/** Family word + recognized variant/tier suffixes -> a human label; unrecognized ids are title-cased segment by segment rather than shown raw. */
export function deriveLabel(id: string): string { return humanize(id).label; }

function humanize(id: string): { label: string; provider: string } {
  const segments = id.split(/-+/).filter(Boolean);
  const parts: string[] = [];
  const variants: string[] = [];
  let provider = 'cursor';
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const lower = seg.toLowerCase();
    if (lower === 'cursor' && i === 0) continue;
    if (lower === 'claude' && segments[i + 1]?.toLowerCase() === 'opus') { parts.push('Claude Opus'); provider = 'anthropic'; i++; continue; }
    if (lower === 'claude' || lower === 'opus') { parts.push(lower === 'claude' ? 'Claude' : 'Opus'); provider = 'anthropic'; continue; }
    const family = FAMILIES[lower];
    if (family) { parts.push(family.name); provider = family.provider; continue; }
    if (lower in VARIANTS) { variants.push(VARIANTS[lower]!); continue; }
    if (/^\d+(\.\d+)*$/.test(seg)) { parts.push(seg); continue; }
    parts.push(titleCase(seg));
  }
  const base = parts.length > 0 ? parts.join(' ') : titleCase(id);
  return { label: variants.length > 0 ? `${base} (${variants.join(', ')})` : base, provider };
}

function toModel(id: string, source: 'detected' | 'static'): RuntimeModel {
  const { label, provider } = humanize(id);
  return { id, label, provider, source };
}

/** `auto` plus the sixteen ids confirmed accepted by `cursor-agent` on 2026-09-10 (VS-200) — used only when the dynamic `--list-models` path is unreachable or unparseable. */
const FALLBACK_IDS = [
  'auto',
  'gpt-5.3-codex-low', 'gpt-5.3-codex-low-fast',
  'gpt-5.3-codex', 'gpt-5.3-codex-fast',
  'gpt-5.3-codex-high', 'gpt-5.3-codex-high-fast',
  'gpt-5.3-codex-xhigh', 'gpt-5.3-codex-xhigh-fast',
  'gpt-5.2',
  'cursor-grok-4.6-high-fast',
  'composer-2.5',
  'claude-opus-5-thinking-high', 'claude-opus-5-thinking-high-fast',
  'gpt-5.6-sol-high', 'gpt-5.6-sol-high-fast',
  'gpt-5.6-sol-xhigh',
];

export const FALLBACK_MODELS: RuntimeModel[] = FALLBACK_IDS.map((id) => toModel(id, 'static'));

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[a-zA-Z]/g;

/**
 * Matches `cursor-agent --list-models`'s real formatter (established by static analysis of the
 * installed CLI bundle, see design.md — never executed): strips ANSI, skips the header and blank
 * lines, stops at the `Tip:` footer, and reads the id as the text before the first `" - "` (or
 * the whole line) with a trailing `" (...)"` parenthetical removed.
 */
export function parseListModelsOutput(text: string): RuntimeModel[] {
  const stripped = text.replace(ANSI_RE, '');
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of stripped.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line === 'Available models') continue;
    if (line.startsWith('Tip:')) break;
    const dashIdx = line.indexOf(' - ');
    let id = dashIdx >= 0 ? line.slice(0, dashIdx) : line;
    id = id.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.map((id) => toModel(id, 'detected'));
}

/** Parses `Cannot use this model: <id>. Available models: <list>`, including the UI-truncated `, ...` form. */
export function parseUnknownModelRejection(text: string): { requested: string; available: string[] } | null {
  const m = /Cannot use this model:\s*(.+?)\.\s*Available models:\s*(.+)/s.exec(text);
  if (!m) return null;
  const requested = m[1]!.trim();
  const available = m[2]!
    .split(',')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => s.length > 0 && !/^\.+$/.test(s));
  if (requested.length === 0) return null;
  return { requested, available };
}

function excerpt(s: string): string {
  const t = s.trim();
  return t.length > LOG_EXCERPT_MAX ? `${t.slice(0, LOG_EXCERPT_MAX)}…` : t;
}

interface ModelsResult { models: RuntimeModel[]; source: 'detected' | 'static' }

async function resolveModels(binaryPath: string | null): Promise<ModelsResult> {
  if (!binaryPath) {
    // This leaf package cannot depend on @agent-conductor/core's logger; a silent fallback is the same failure this ticket exists to fix, one level up.
    console.warn('[cursor] listModels: cursor-agent not found on PATH; using the static fallback catalogue'); // ac-allow-console
    return { models: FALLBACK_MODELS.map((m) => ({ ...m })), source: 'static' };
  }
  let stdout = '';
  let stderr = '';
  try {
    const out = await pExecFile(binaryPath, ['--list-models'], { timeout: LIST_MODELS_TIMEOUT_MS, maxBuffer: LIST_MODELS_MAX_BUFFER });
    stdout = out.stdout;
    stderr = out.stderr;
  } catch (e) {
    const err = e as { killed?: boolean; signal?: string | null; stdout?: string; stderr?: string; message?: string };
    const reason = err.killed || err.signal ? 'timed out' : 'exited non-zero';
    console.warn(`[cursor] listModels: --list-models ${reason}; using the static fallback catalogue. output: ${excerpt(err.stderr || err.stdout || err.message || '')}`); // ac-allow-console
    return { models: FALLBACK_MODELS.map((m) => ({ ...m })), source: 'static' };
  }
  const parsed = parseListModelsOutput(stdout || stderr);
  if (parsed.length === 0) {
    console.warn(`[cursor] listModels: --list-models produced no parseable model ids; using the static fallback catalogue. output: ${excerpt(stdout || stderr)}`); // ac-allow-console
    return { models: FALLBACK_MODELS.map((m) => ({ ...m })), source: 'static' };
  }
  if (!parsed.some((m) => m.id === 'auto')) parsed.unshift(toModel('auto', 'detected'));
  return { models: parsed, source: 'detected' };
}

let cache: { expiresAt: number; result: ModelsResult } | null = null;

/** Test-only: clears the module-level cache so each test starts from a clean slate. */
export function _resetModelsCacheForTests(): void { cache = null; }

/**
 * `binaryPath` is a test-only override: passing it (even `null`, meaning "simulate no binary")
 * skips the real `which('cursor-agent')` lookup entirely, so tests never resolve or spawn the
 * real installed CLI. The production caller (`adapter.ts`) always omits it.
 */
export async function listModels(opts?: { binaryPath?: string | null }): Promise<RuntimeModel[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.result.models.map((m) => ({ ...m }));
  const binaryPath = opts && 'binaryPath' in opts ? (opts.binaryPath ?? null) : await which('cursor-agent');
  const result = await resolveModels(binaryPath);
  cache = { expiresAt: now + CACHE_TTL_MS, result };
  return result.models.map((m) => ({ ...m }));
}
