/** Provider resolution: presets, layers, precedence. Uses the shared zod schemas, so the child's run path (loop.ts) must not import it: the child starts from source in tests, where `shared` is not built. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProviderCompatSchema, ProviderParamsSchema, type ProviderCompat, type ProviderParams } from '@weave-ai/shared';
import { completeCompat, parseExtraHeaders, type Compat, type Params } from './codec/params.js';

const PARAM_KEYS = Object.keys(ProviderParamsSchema.shape) as Array<keyof ProviderParams>;

/** The option keys of a role or worker option, checked against the parameter schema. Wrong-typed or out-of-range values are errors, never silently dropped. */
export function paramsFromOptions(options: Record<string, unknown> | undefined): { params: Params; errors: string[] } {
  const picked: Record<string, unknown> = {};
  for (const k of PARAM_KEYS) if (options?.[k] !== undefined) picked[k] = options[k];
  // Whole-number parameters are floored, as S1 did for the output cap, rather than rejected.
  for (const k of ['maxOutputTokens', 'seed']) if (typeof picked[k] === 'number' && Number.isFinite(picked[k])) picked[k] = Math.floor(picked[k] as number);
  const parsed = ProviderParamsSchema.safeParse(picked);
  const params: Params = parsed.success ? { ...parsed.data } : {};
  const errors = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.') || 'option'}: ${i.message}`);
  const c = options?.['contextWindowTokens'];
  if (typeof c === 'number' && Number.isFinite(c) && c > 0) params.contextWindowTokens = Math.floor(c);
  return { params, errors };
}

/** A built-in preset: base flags for a known endpoint. `verified` names the recorded capture proving each flag, or is `false` when none does. */
export interface Preset { description?: string; compat?: ProviderCompat; params?: ProviderParams; verified: false | Record<string, string> }

export const presetsDir = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', 'presets');
const presetCache = new Map<string, Preset>();

/** Read and validate `presets/<name>.json`; `undefined` when there is no such preset. */
export function loadPreset(name: string): Preset | undefined {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return undefined;
  const hit = presetCache.get(name);
  if (hit) return hit;
  const file = join(presetsDir(), `${name}.json`);
  if (!existsSync(file)) return undefined;
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const preset: Preset = {
    ...(typeof raw['description'] === 'string' ? { description: raw['description'] } : {}),
    ...(raw['compat'] !== undefined ? { compat: ProviderCompatSchema.parse(raw['compat']) } : {}),
    ...(raw['params'] !== undefined ? { params: ProviderParamsSchema.parse(raw['params']) } : {}),
    verified: raw['verified'] && typeof raw['verified'] === 'object' ? raw['verified'] as Record<string, string> : false,
  };
  presetCache.set(name, preset);
  return preset;
}

export const PRESET_NAMES = ['openai-compatible', 'openai', 'azure-openai', 'openrouter', 'deepseek', 'together', 'groq', 'fireworks', 'mistral', 'ollama', 'lmstudio', 'vllm', 'llamacpp', 'litellm', 'cheaper-inference', 'zai'] as const;

/** Field-wise merge of compat layers, lowest first: a set field replaces, nested blocks merge, `omitParams` is the union. */
export function mergeCompat(...layers: Array<ProviderCompat | undefined>): ProviderCompat {
  const out: ProviderCompat = {};
  for (const l of layers) {
    if (!l) continue;
    const { reasoning, tools, omitParams, ...flat } = l;
    for (const [k, v] of Object.entries(flat)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
    if (omitParams) out.omitParams = [...new Set([...(out.omitParams ?? []), ...omitParams])];
    if (reasoning) out.reasoning = { ...out.reasoning, ...Object.fromEntries(Object.entries(reasoning).filter(([, v]) => v !== undefined)) };
    if (tools) out.tools = { ...out.tools, ...Object.fromEntries(Object.entries(tools).filter(([, v]) => v !== undefined)) };
  }
  return out;
}

export function mergeParams(...layers: Array<Params | undefined>): Params {
  const out: Params = {};
  for (const l of layers) if (l) for (const [k, v] of Object.entries(l)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

export interface ResolveInput {
  preset?: Preset | undefined;
  profile: { compat?: ProviderCompat | undefined; params?: ProviderParams | undefined };
  model?: { compat?: ProviderCompat | undefined; params?: ProviderParams | undefined } | undefined;
  /** The role or worker option: the highest layer. */
  options?: Record<string, unknown> | undefined;
}
export interface Resolved { compat: Compat; params: Params; errors: string[] }

/**
 * Precedence, lowest to highest: preset, provider profile, model entry, role or worker option. A
 * parameter no layer sets stays unset (and is therefore never sent). Pure: no I/O, no defaults for
 * parameters, only for compat flags.
 */
export function resolveProvider(i: ResolveInput): Resolved {
  const fromOptions = paramsFromOptions(i.options);
  return {
    compat: completeCompat(mergeCompat(i.preset?.compat, i.profile.compat, i.model?.compat)),
    params: mergeParams(i.preset?.params, i.profile.params, i.model?.params, fromOptions.params),
    errors: fromOptions.errors,
  };
}

/** `extraHeaders` folded into a provider's headers; extra headers never override the ones the profile names. */
export function headersWithExtras(headers: Record<string, string>, extra: string[] | undefined): { headers: Record<string, string>; errors: string[] } {
  const parsed = parseExtraHeaders(extra);
  return { headers: { ...parsed.headers, ...headers }, errors: parsed.errors };
}

