/**
 * `runEventsToTranscript` — the single implementation of transcript semantics (PLAN §21.3).
 *
 * Rules, in the order they matter:
 *  - adjacent `assistant.text` events merge into one paragraph block;
 *  - `tool.call` + its `tool.result` (or `tool.denied`) fold into one collapsible block carrying
 *    name, target and duration;
 *  - `file.changed` becomes a diff-ish block with +/− counters;
 *  - `run.phase.timing` becomes a phase line, `supervisor.action` and the lifecycle events become
 *    status lines;
 *  - everything that reaches a screen is redacted first.
 *
 * Payload shapes are read defensively: the runtime adapters normalise events, but a missing field
 * must degrade to a shorter line, never to a crash.
 */
import type { RunEvent } from '@openconductor/shared';
import { formatDuration, formatTokens, formatDiffStat, oneLine } from './format.js';
import { redact } from './redact.js';
import type { ErrorBlock, FileBlock, PhaseBlock, StatusBlock, TextBlock, ToolBlock, TranscriptBlock, TranscriptOptions } from './types.js';

type Payload = Record<string, unknown>;

const str = (p: Payload | undefined, ...keys: string[]): string | null => {
  if (!p) return null;
  for (const k of keys) {
    const v = p[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
};
const num = (p: Payload | undefined, ...keys: string[]): number | null => {
  if (!p) return null;
  for (const k of keys) {
    const v = p[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
};
const bool = (p: Payload | undefined, ...keys: string[]): boolean | null => {
  if (!p) return null;
  for (const k of keys) if (typeof p[k] === 'boolean') return p[k] as boolean;
  return null;
};
const obj = (p: Payload | undefined, ...keys: string[]): Payload | null => {
  if (!p) return null;
  for (const k of keys) {
    const v = p[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Payload;
  }
  return null;
};

/** Tool output arrives as a string, a list of content parts, or an arbitrary object. */
function bodyText(value: unknown, depth = 0): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (depth > 3) return null;
    const parts = value.map((v) => bodyText(v, depth + 1)).filter((v): v is string => !!v);
    return parts.length ? parts.join('\n') : null;
  }
  if (typeof value === 'object') {
    const o = value as Payload;
    const direct = str(o, 'text', 'content', 'output', 'stdout', 'message', 'body');
    if (direct) return direct;
    if (depth > 3) return null;
    try { return JSON.stringify(o, null, 2); } catch { return null; }
  }
  return null;
}

/** The one thing the tool acted on — a path beats a command beats a pattern beats a url. */
function toolTarget(name: string, input: Payload | null): string | null {
  if (!input) return null;
  const path = str(input, 'file_path', 'filePath', 'path', 'notebook_path', 'notebookPath', 'target');
  if (path) return shortenPath(path);
  const cmd = str(input, 'command', 'cmd', 'script');
  if (cmd) return oneLine(cmd, 80);
  const pattern = str(input, 'pattern', 'query', 'q', 'search');
  if (pattern) return oneLine(pattern, 60);
  const url = str(input, 'url', 'uri');
  if (url) return oneLine(url, 80);
  const prompt = str(input, 'prompt', 'description');
  if (prompt) return oneLine(prompt, 60);
  if (/^oc_/.test(name)) {
    const id = str(input, 'ticketId', 'id', 'workerId', 'roleId', 'decisionId');
    if (id) return id;
  }
  return null;
}

/** Keep the last two segments; an absolute path in a 80-column pane is mostly noise. */
function shortenPath(p: string): string {
  const clean = p.replace(/\/+$/, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts.length <= 2 || clean.length <= 40) return clean;
  return `…/${parts.slice(-2).join('/')}`;
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}\n…`, truncated: true };
}

const CHANGE_TYPES = new Set(['created', 'modified', 'deleted', 'renamed']);
function changeType(p: Payload): FileBlock['changeType'] {
  const raw = (str(p, 'changeType', 'change', 'action', 'op', 'kind') ?? '').toLowerCase();
  if (CHANGE_TYPES.has(raw)) return raw as FileBlock['changeType'];
  if (raw === 'create' || raw === 'add' || raw === 'added' || raw === 'write') return 'created';
  if (raw === 'delete' || raw === 'removed' || raw === 'remove') return 'deleted';
  if (raw === 'rename' || raw === 'move' || raw === 'moved') return 'renamed';
  return 'modified';
}

const PHASE_LABELS: Record<string, string> = {
  prepare_home: 'preparing home',
  prepare_worktree: 'preparing worktree',
  build_prompt: 'building prompt',
  spawn: 'spawning',
  turn: 'turn',
  collect_result: 'collecting result',
  finalize: 'finalising',
};

export function runEventsToTranscript(events: readonly RunEvent[] | null | undefined, options: TranscriptOptions = {}): TranscriptBlock[] {
  const list = Array.isArray(events) ? [...events] : [];
  const doRedact = options.redact !== false;
  const maxDetail = options.maxDetailChars ?? 4000;
  const scrub = (s: string | null): string | null => (s === null ? null : doRedact ? redact(s) : s);

  list.sort((a, b) => (a?.seq ?? 0) - (b?.seq ?? 0));

  const blocks: TranscriptBlock[] = [];
  /** call id → index in `blocks`, so a late tool.result folds back into its call. */
  const pendingTools = new Map<string, number>();
  let lastText: TextBlock | null = null;
  let tokensSinceLastPhase = 0;

  const push = (block: TranscriptBlock): TranscriptBlock => {
    blocks.push(block);
    if (block.kind !== 'text' && block.kind !== 'thinking') lastText = null;
    return block;
  };
  const base = (ev: RunEvent) => ({ id: ev.id ?? `${ev.runId ?? 'run'}:${ev.seq}`, ts: ev.ts ?? new Date(0).toISOString(), seq: ev.seq ?? 0, eventIds: [ev.id ?? `${ev.seq}`] });
  const status = (ev: RunEvent, text: string, tone: StatusBlock['tone'] = 'info', detail: string | null = null): StatusBlock =>
    ({ ...base(ev), kind: 'status', text, tone, detail });

  for (const ev of list) {
    if (!ev || typeof ev !== 'object') continue;
    const p: Payload = (ev.payload ?? {}) as Payload;

    switch (ev.type) {
      case 'assistant.text':
      case 'assistant.thinking': {
        const raw = bodyText(p['text'] ?? p['content'] ?? p['message'] ?? p['delta']) ?? '';
        const text = scrub(raw) ?? '';
        if (!text.trim()) break;
        const kind: TextBlock['kind'] = ev.type === 'assistant.thinking' ? 'thinking' : 'text';
        if (lastText && lastText.kind === kind) {
          lastText.text = `${lastText.text}${lastText.text.endsWith('\n') || text.startsWith('\n') ? '' : joinGap(lastText.text, text)}${text}`;
          lastText.eventIds.push(ev.id ?? `${ev.seq}`);
        } else {
          lastText = push({ ...base(ev), kind, text }) as TextBlock;
        }
        break;
      }

      case 'tool.call': {
        const name = str(p, 'name', 'tool', 'toolName') ?? 'tool';
        const input = obj(p, 'input', 'args', 'arguments', 'params');
        const target = scrub(toolTarget(name, input));
        const block: ToolBlock = {
          ...base(ev), kind: 'tool', name, target, status: 'pending', durationMs: null,
          collapsed: collapsedToolLine(name, target, null), detail: null, detailTruncated: false, diffStat: null,
        };
        push(block);
        const callId = str(p, 'callId', 'id', 'toolCallId', 'toolUseId');
        if (callId) pendingTools.set(callId, blocks.length - 1);
        else pendingTools.set(`@name:${name}`, blocks.length - 1);
        break;
      }

      case 'tool.result':
      case 'tool.denied': {
        const callId = str(p, 'callId', 'id', 'toolCallId', 'toolUseId');
        const name = str(p, 'name', 'tool', 'toolName') ?? 'tool';
        const idx: number | undefined = (callId ? pendingTools.get(callId) : undefined) ?? pendingTools.get(`@name:${name}`);
        const target = idx !== undefined ? (blocks[idx] as ToolBlock | undefined)?.target ?? null : null;
        const denied = ev.type === 'tool.denied';
        const isError = denied || bool(p, 'isError', 'error') === true || str(p, 'errorText', 'error') !== null;
        const duration = num(p, 'durationMs', 'duration_ms', 'elapsedMs', 'ms');
        const raw = bodyText(p['output'] ?? p['result'] ?? p['content'] ?? p['text'] ?? p['reason'] ?? p['error']);
        const detailRaw = scrub(raw);
        const detail = detailRaw ? truncate(detailRaw, maxDetail) : null;
        const diffStat = formatDiffStat(num(p, 'additions', 'linesAdded'), num(p, 'deletions', 'linesRemoved'));

        if (idx !== undefined && blocks[idx] && blocks[idx]!.kind === 'tool') {
          const tool = blocks[idx] as ToolBlock;
          tool.status = denied ? 'denied' : isError ? 'error' : 'ok';
          tool.durationMs = duration ?? elapsed(tool.ts, ev.ts);
          tool.detail = detail?.text ?? null;
          tool.detailTruncated = detail?.truncated ?? false;
          tool.diffStat = diffStat;
          tool.collapsed = collapsedToolLine(tool.name, tool.target, tool.durationMs, tool.status, diffStat);
          tool.eventIds.push(ev.id ?? `${ev.seq}`);
          if (callId) pendingTools.delete(callId);
          else pendingTools.delete(`@name:${name}`);
        } else {
          // A result without its call (resumed session, truncated window): still show it.
          push({
            ...base(ev), kind: 'tool', name, target, status: denied ? 'denied' : isError ? 'error' : 'ok',
            durationMs: duration, collapsed: collapsedToolLine(name, target, duration, denied ? 'denied' : isError ? 'error' : 'ok', diffStat),
            detail: detail?.text ?? null, detailTruncated: detail?.truncated ?? false, diffStat,
          } satisfies ToolBlock);
        }
        break;
      }

      case 'command.executed': {
        const cmd = scrub(str(p, 'command', 'cmd')) ?? '';
        const exitCode = num(p, 'exitCode', 'code');
        const duration = num(p, 'durationMs', 'duration_ms');
        const outRaw = scrub(bodyText(p['stdout'] ?? p['output'] ?? p['stderr']));
        const detail = outRaw ? truncate(outRaw, maxDetail) : null;
        const st: ToolBlock['status'] = exitCode === null ? 'ok' : exitCode === 0 ? 'ok' : 'error';
        push({
          ...base(ev), kind: 'tool', name: 'shell', target: oneLine(cmd, 80), status: st, durationMs: duration,
          collapsed: collapsedToolLine('shell', oneLine(cmd, 80), duration, st, exitCode !== null && exitCode !== 0 ? `exit ${exitCode}` : null),
          detail: detail?.text ?? null, detailTruncated: detail?.truncated ?? false, diffStat: null,
        } satisfies ToolBlock);
        break;
      }

      case 'file.changed': {
        const path = str(p, 'path', 'file', 'file_path', 'filePath') ?? 'unknown file';
        const additions = num(p, 'additions', 'added', 'linesAdded') ?? 0;
        const deletions = num(p, 'deletions', 'removed', 'linesRemoved') ?? 0;
        const type = changeType(p);
        const diffRaw = scrub(bodyText(p['diff'] ?? p['patch'] ?? p['hunks']));
        const diff = diffRaw ? truncate(diffRaw, maxDetail) : null;
        const stat = formatDiffStat(additions, deletions);
        push({
          ...base(ev), kind: 'file', path: shortenPath(path), changeType: type, additions, deletions,
          diffStat: stat, diff: diff?.text ?? null, diffTruncated: diff?.truncated ?? false,
          collapsed: [type === 'modified' ? 'Edit' : type[0]!.toUpperCase() + type.slice(1), shortenPath(path), stat].filter(Boolean).join(' '),
        } satisfies FileBlock);
        break;
      }

      case 'usage.delta': {
        const inTok = num(p, 'inputTokens', 'input_tokens') ?? 0;
        const outTok = num(p, 'outputTokens', 'output_tokens') ?? 0;
        tokensSinceLastPhase += inTok + outTok;
        break;
      }

      case 'run.phase.timing': {
        const phase = str(p, 'phase', 'name') ?? 'phase';
        const duration = num(p, 'durationMs', 'duration_ms', 'ms');
        const tokens = num(p, 'tokens', 'totalTokens') ?? (tokensSinceLastPhase || null);
        tokensSinceLastPhase = 0;
        const label = PHASE_LABELS[phase] ?? phase;
        const text = ['phase:', label, duration !== null ? `· ${formatDuration(duration)}` : null, tokens ? `· ${formatTokens(tokens)} tok` : null]
          .filter(Boolean).join(' ');
        push({ ...base(ev), kind: 'phase', phase, durationMs: duration, tokens, text } satisfies PhaseBlock);
        break;
      }

      case 'supervisor.action': {
        const action = str(p, 'action', 'kind') ?? 'supervisor acted';
        const reason = scrub(str(p, 'reason', 'note', 'detail'));
        const severity = (str(p, 'severity', 'level') ?? '').toLowerCase();
        const tone: StatusBlock['tone'] = severity === 'error' ? 'error' : severity === 'warn' || severity === 'warning' ? 'warn' : 'warn';
        push(status(ev, `supervisor: ${action.replace(/_/g, ' ')}${reason ? ` — ${oneLine(reason, 100)}` : ''}`, tone, reason));
        break;
      }

      case 'session.started':
      case 'session.resumed': {
        const model = str(p, 'model');
        const sid = str(p, 'sessionId', 'session_id');
        push(status(ev, ['session', ev.type === 'session.resumed' ? 'resumed' : 'started', model ? `· ${model}` : null, sid ? `· ${oneLine(sid, 24)}` : null].filter(Boolean).join(' ')));
        break;
      }

      case 'run.started': {
        const model = str(p, 'model');
        const runtime = str(p, 'runtimeId', 'runtime');
        push(status(ev, ['run started', runtime ? `· ${runtime}` : null, model ? `· ${model}` : null].filter(Boolean).join(' ')));
        break;
      }

      case 'turn.started': {
        const turn = num(p, 'turn', 'turnCount', 'turnEpoch');
        push(status(ev, turn !== null ? `turn ${turn} started` : 'turn started'));
        break;
      }

      case 'turn.completed': {
        const tokens = num(p, 'tokens', 'totalTokens');
        const duration = num(p, 'durationMs', 'duration_ms');
        push(status(ev, ['turn completed', duration !== null ? `· ${formatDuration(duration)}` : null, tokens !== null ? `· ${formatTokens(tokens)} tok` : null].filter(Boolean).join(' ')));
        break;
      }

      case 'run.finalized': {
        const st = str(p, 'status', 'state') ?? 'finished';
        const summary = scrub(str(p, 'summary'));
        const tone: StatusBlock['tone'] = st === 'failed' || st === 'timed_out' ? 'error' : st === 'cancelled' || st === 'interrupted' ? 'warn' : 'info';
        push(status(ev, `run ${st.replace(/_/g, ' ')}${summary ? ` — ${oneLine(summary, 120)}` : ''}`, tone, summary));
        break;
      }

      case 'plan.proposed': {
        const title = scrub(str(p, 'title', 'changeName', 'name'));
        const planBody = scrub(bodyText(p['plan'] ?? p['body'] ?? p['tasks']));
        push(status(ev, `proposed a plan${title ? `: ${oneLine(title, 80)}` : ''} · waiting for approval`, 'info', planBody ? truncate(planBody, maxDetail).text : null));
        break;
      }

      case 'user_input.requested': {
        const q = scrub(str(p, 'question', 'title', 'text', 'prompt'));
        const waited = elapsed(ev.ts, (options.now ?? new Date()).toISOString());
        push(status(ev, `asked you a question${q ? `: ${oneLine(q, 90)}` : ''}${waited !== null ? ` · waiting ${formatDuration(waited)}` : ''}`, 'warn', q));
        break;
      }

      case 'permission.requested': {
        const tool = str(p, 'tool', 'name');
        push(status(ev, `asked for permission${tool ? `: ${tool}` : ''}`, 'warn'));
        break;
      }

      case 'error': {
        const message = scrub(str(p, 'message', 'error', 'text')) ?? 'unknown error';
        push({
          ...base(ev), kind: 'error', code: str(p, 'code', 'errorCode', 'family'),
          message: oneLine(message, 400), retryable: bool(p, 'retryable') ?? false,
        } satisfies ErrorBlock);
        break;
      }

      case 'runtime.raw':
      default:
        break;
    }
  }

  // A tool that never got a result still reads correctly: it is simply still pending.
  return blocks;
}

function joinGap(prev: string, next: string): string {
  if (!prev) return '';
  const endsSentence = /[.!?:]$/.test(prev.trimEnd());
  const startsLower = /^[a-z]/.test(next);
  return endsSentence || !startsLower ? '\n\n' : ' ';
}

function elapsed(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return b - a;
}

/** `Read src/theme/tokens.ts 0.4s` / `Edit …/tokens.ts +18 −2 1.2s` / `Bash npm test failed 4m12s` */
function collapsedToolLine(name: string, target: string | null, durationMs: number | null, status?: ToolBlock['status'], extra?: string | null): string {
  const parts = [prettyToolName(name)];
  if (target) parts.push(target);
  if (extra) parts.push(extra);
  if (status === 'denied') parts.push('denied');
  else if (status === 'error') parts.push('failed');
  if (durationMs !== null && durationMs !== undefined) parts.push(formatDuration(durationMs));
  return parts.join(' ');
}

function prettyToolName(name: string): string {
  if (name.startsWith('oc_')) return name;
  if (name.startsWith('mcp__')) return name.split('__').slice(-1)[0] ?? name;
  return name;
}
