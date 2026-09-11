import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  AccountDescription, AccountProbeInput, AgentHome, InstructionBundle, JsonSchema, RuntimeAdapter,
  RuntimeCapabilities, RuntimeDetection, RuntimeModel, SessionRef, TurnHandle, TurnInput, TurnResult, TurnSink,
} from '@agent-conductor/runtime-sdk';
import { classifyError, detectBinary, installBundleFiles, launchCommand, spawnLines, which, writeFiles } from '@agent-conductor/runtime-sdk';
import { extractReport } from '@agent-conductor/shared';
import { describeOpenCodeAccount } from './account.js';
import { buildArgs, CONFIG_RELATIVE_PATH, opencodeConfig } from './args.js';
import { createOpenCodeParser } from './events.js';
import { asOpenCodeSession, type OpenCodeSessionRef } from './session.js';

const pExecFile = promisify(execFile);

export const capabilities: RuntimeCapabilities = {
  resumableSessions: true,
  forkSessions: true,
  streamingInput: false,
  systemPromptInjection: 'file_only',
  structuredOutput: false,
  mcp: true,
  usageReporting: 'per_turn',
  costReporting: true,
  permissionModes: ['auto', 'restricted', 'bypass'],
};

/** Used only when `opencode models` cannot be run (binary missing, no providers configured). */
const FALLBACK_MODELS: RuntimeModel[] = [
  { id: 'anthropic/claude-sonnet-5', label: 'anthropic/claude-sonnet-5', provider: 'anthropic', source: 'static' },
  { id: 'openai/gpt-5.1', label: 'openai/gpt-5.1', provider: 'openai', source: 'static' },
  { id: 'google/gemini-3-pro', label: 'google/gemini-3-pro', provider: 'google', source: 'static' },
];

const CONFIG_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    model: { type: 'string', description: 'provider/model, e.g. anthropic/claude-sonnet-5' },
    effort: { type: 'string', description: 'Provider-specific reasoning variant (--variant), e.g. high' },
    agent: { type: 'string', description: 'Named agent from .opencode/agent' },
    permissionMode: { type: 'string', enum: ['auto', 'restricted', 'bypass'] },
    maxTurns: { type: 'integer', minimum: 1, description: 'Not enforced by opencode; used by the supervisor only' },
    maxBudgetUsd: { type: 'number', exclusiveMinimum: 0, description: 'Not enforced by opencode; used by the supervisor only' },
    extraArgs: { type: 'array', items: { type: 'string' } },
  },
};

function isModelIdLine(line: string): boolean {
  const id = line.trim();
  return id.length > 0 && id.includes('/') && !/\s/.test(id);
}

/** Slice a JSON object starting at `from`, respecting strings so braces in values do not end early. */
function takeJsonObject(text: string, from: number): { json: string; end: number } | null {
  const start = text.indexOf('{', from);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { json: text.slice(start, i + 1), end: i + 1 };
    }
  }
  return null;
}

function effortsFromVariants(variants: unknown): string[] {
  if (variants == null || typeof variants !== 'object' || Array.isArray(variants)) return [];
  const rec = variants as Record<string, { disabled?: boolean } | undefined>;
  return Object.keys(rec).filter((k) => rec[k]?.disabled !== true);
}

/**
 * Parse `opencode models` / `opencode models --verbose`.
 * Non-verbose: one `provider/model` per line, `efforts` omitted, label is the id.
 * Verbose (captured 2026-09-11, OpenCode 1.18.30): id line, then a JSON object whose `name` is
 * the CLI's own display name (used as the label) and whose `variants` keys are the thinking
 * levels (`{}` → `[]`). A variant with `disabled: true` is skipped.
 */
export function parseModels(stdout: string): RuntimeModel[] {
  const out: RuntimeModel[] = [];
  const lines = stdout.split('\n');
  let i = 0;
  while (i < lines.length) {
    const id = lines[i]!.trim();
    i += 1;
    if (!isModelIdLine(id)) continue;
    const provider = id.slice(0, id.indexOf('/'));
    const model: RuntimeModel = { id, label: id, provider, source: 'detected' };
    while (i < lines.length && lines[i]!.trim() === '') i += 1;
    if (i < lines.length && lines[i]!.trim().startsWith('{')) {
      const chunk = lines.slice(i).join('\n');
      const taken = takeJsonObject(chunk, 0);
      if (taken) {
        try {
          const obj = JSON.parse(taken.json) as { name?: unknown; variants?: unknown };
          if (obj && typeof obj === 'object') {
            if (typeof obj.name === 'string' && obj.name.length > 0) model.label = obj.name;
            if ('variants' in obj) model.efforts = effortsFromVariants(obj.variants);
          }
        } catch { /* omit name/efforts */ }
        i += chunk.slice(0, taken.end).split('\n').length;
      }
    }
    out.push(model);
  }
  return out;
}

export const adapter: RuntimeAdapter = {
  id: 'opencode',
  displayName: 'OpenCode',
  capabilities,

  detect(): Promise<RuntimeDetection> { return detectBinary('opencode', ['--version']); },

  async listModels(): Promise<RuntimeModel[]> {
    try {
      const exe = (await which('opencode')) ?? 'opencode';
      const { stdout } = await pExecFile(exe, ['models', '--verbose'], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
      const models = parseModels(stdout);
      if (models.length > 0) return models;
    } catch { /* fall through to the static list */ }
    return FALLBACK_MODELS.map((m) => ({ ...m }));
  },

  configSchema(): JsonSchema { return structuredClone(CONFIG_SCHEMA); },
  skillsDir(): string { return '.opencode/skills'; },
  instructionFiles(): string[] { return ['AGENTS.md']; },

  async installInstructions(home: AgentHome, bundle: InstructionBundle): Promise<void> {
    installBundleFiles(home, bundle, {
      instructions: { 'AGENTS.md': bundle.instructions },
      skillsDir: '.opencode/skills',
      // Placeholder config; runTurn rewrites it with the per-run MCP endpoint before each turn.
      extraFiles: { [CONFIG_RELATIVE_PATH]: opencodeConfig({}) },
    });
  },

  async forkSession(base: SessionRef): Promise<SessionRef> {
    const ref = asOpenCodeSession(base);
    if (!ref) throw new Error('opencode: cannot fork a session without a sessionId');
    // `--fork` needs `-s <id>` and a message, so the fork lands on the next turn.
    return { sessionId: ref.sessionId, fork: true } satisfies OpenCodeSessionRef;
  },

  async describeSession(ref: SessionRef) {
    const s = asOpenCodeSession(ref);
    return { displayId: s?.sessionId ?? 'unknown', exists: Boolean(s) };
  },

  /** Static: OpenCode bills through provider keys and has no plan limits. */
  async describeAccount(): Promise<AccountDescription> { return describeOpenCodeAccount(); },

  async runTurn(input: TurnInput, sink: TurnSink, onHandle?: (h: TurnHandle) => void): Promise<TurnResult> {
    const built = buildArgs(input);
    writeFiles(built.files);

    const parser = createOpenCodeParser({ resumed: built.resumed });
    let seq = 0;
    const launch = launchCommand(built.cmd, built.env);
    const run = spawnLines({
      cmd: launch.cmd,
      args: built.args,
      cwd: input.cwd,
      env: launch.env,
      stdin: null,
      timeoutMs: input.limits.timeoutMs,
      onSpawn: (pid) => sink.onSpawn({ pid, pgid: pid }),
      onLine: (stream, line) => {
        sink.onRaw(stream, line);
        if (stream === 'stdout') for (const ev of parser.handle(line)) sink.onEvent({ ...ev, seq: seq++ });
      },
    });
    onHandle?.({ pid: run.child.pid ?? null, cancel: (mode) => run.cancel(mode) });

    const outcome = await run.done;
    for (const ev of parser.finish()) sink.onEvent({ ...ev, seq: seq++ });

    const st = parser.state;
    // No native structured output: the report is a fenced json block in the final text (§9.4).
    const structured = extractReport(st.finalText) ?? undefined;
    const failed = outcome.exitCode !== 0 || outcome.timedOut || st.isError;
    const error = failed
      ? classifyError(outcome.exitCode ?? 1, `${st.errorMessage ?? ''}\n${outcome.stderr}`) ?? {
        code: 'runtime_error', family: 'unknown' as const, message: st.errorMessage ?? 'opencode turn failed',
      }
      : undefined;

    return {
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: outcome.timedOut,
      session: st.sessionId ? { sessionId: st.sessionId } : (built.sessionId ? { sessionId: built.sessionId } : null),
      finalText: st.finalText,
      ...(structured !== undefined ? { structured } : {}),
      ...(st.usage
        ? { usage: { ...st.usage, ...(st.contextTokens != null ? { contextTokens: st.contextTokens } : {}), basis: 'per_turn' as const } }
        : {}),
      ...(st.costUsd != null ? { cost: { usd: st.costUsd, status: 'reported' as const } } : {}),
      ...(input.model ? { model: input.model } : {}),
      provider: 'opencode',
      ...(error ? { error } : {}),
    };
  },
};

export default adapter;
