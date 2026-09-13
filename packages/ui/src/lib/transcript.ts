import type { ReportState, RunEvent, RunReport, UiStatus } from '@weave-ai/shared';
import { extractReport } from '@weave-ai/shared';
import type { EditPair } from '@weave-ai/render';

/** What an edit-type tool call carries, extracted from its `tool.call` input (VS-324): neither
 * `tool.result` nor `file.changed` carry this on any runtime — see design.md. */
export type EditPayload =
  | { kind: 'edit'; edits: EditPair[] }
  | { kind: 'write'; content: string };

export type TranscriptBlock =
  | { id: string; type: 'text'; text: string; thinking?: boolean; thinkingDurationMs?: number | null }
  | { id: string; type: 'tool'; tool: string; target: string; durationMs: number | null; adds: number | null; dels: number | null; diff: string | null; error?: boolean; pending?: boolean; denied?: boolean; editPayload?: EditPayload | null }
  | { id: string; type: 'phase'; phase: string; durationMs: number | null; tokens: number | null }
  | { id: string; type: 'status'; text: string; status: 'needs-you' | 'blocked' | 'failed' | 'done' | 'working' }
  | { id: string; type: 'command'; command: string; exitCode: number | null; output: string | null }
  | { id: string; type: 'human'; text: string; delivery: 'mid_turn' | 'queued' }
  | { id: string; type: 'report'; report: RunReport; text: string };

export type ToolBlock = Extract<TranscriptBlock, { type: 'tool' }>;

/** A display row: one block, or a run of consecutive same-name tool calls (N ≥ 2). */
export type TranscriptRow =
  | { type: 'single'; block: TranscriptBlock }
  | { type: 'tools'; id: string; tool: string; calls: ToolBlock[] };

/**
 * Fold adjacent `type: 'tool'` blocks with the same `tool` name into groups of size ≥ 2.
 * Any other block type, or a different name, starts a new row. Exact string match.
 *
 * An edit-type block (`editPayload` set) is never folded into a group, even with an adjacent call
 * of the same name (VS-324 review): each edit shows its own diff or written content directly, not
 * behind a second click to expand a counted row.
 */
export function groupConsecutiveTools(blocks: readonly TranscriptBlock[]): TranscriptRow[] {
  const out: TranscriptRow[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (!block) break;
    if (block.type !== 'tool' || block.editPayload) {
      out.push({ type: 'single', block });
      i += 1;
      continue;
    }
    const calls: ToolBlock[] = [block];
    while (i + calls.length < blocks.length) {
      const next = blocks[i + calls.length];
      if (!next || next.type !== 'tool' || next.tool !== block.tool || next.editPayload) break;
      calls.push(next);
    }
    if (calls.length >= 2) out.push({ type: 'tools', id: block.id, tool: block.tool, calls });
    else out.push({ type: 'single', block });
    i += calls.length;
  }
  return out;
}

export function reportUiStatus(state: ReportState): UiStatus {
  if (state === 'needs_decision') return 'needs-you';
  if (state === 'paused') return 'stalled';
  return state;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

/** The adapters disagree on which key carries a tool call's id, so try all of them. */
function callKey(p: Record<string, unknown>, fallback: string): string {
  for (const k of ['callId', 'id', 'toolCallId', 'toolUseId']) {
    const v = p[k];
    if (typeof v === 'string' && v) return v;
  }
  return fallback;
}

/** A tool result's body: a string, or whatever structure the runtime wrapped it in. */
function resultText(p: Record<string, unknown>): string | null {
  for (const k of ['content', 'output', 'result', 'text', 'stdout', 'reason', 'error']) {
    const v = p[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (v && typeof v === 'object') {
      try { return JSON.stringify(v); } catch { /* circular: fall through */ }
    }
  }
  return null;
}

/** Claude `Edit`'s (and opencode `edit`'s) `{ old, new }` field names differ by runtime; both are
 * read here so callers never branch on which one produced the call. */
function editPair(o: Record<string, unknown>): EditPair | null {
  const oldText = o['old_string'] ?? o['oldString'];
  const newText = o['new_string'] ?? o['newString'];
  return typeof oldText === 'string' && typeof newText === 'string' ? { oldText, newText } : null;
}

/**
 * An edit-type tool call's before/after text (or a written file's content), read straight from the
 * `tool.call`'s own `input` — the only place any runtime puts it (verified against
 * `packages/runtimes/{claude,opencode}/src/events.ts`; `tool.result`/`file.changed` carry neither).
 * A tool this does not recognise, or a recognised one missing the fields it needs, returns `null` —
 * the caller renders today's compact row for it.
 */
function parseEditPayload(name: string, input: unknown): EditPayload | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;

  if (name === 'Edit' || name === 'edit') {
    const pair = editPair(o);
    return pair ? { kind: 'edit', edits: [pair] } : null;
  }
  if (name === 'MultiEdit') {
    const raw = o['edits'];
    if (!Array.isArray(raw)) return null;
    const edits: EditPair[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const pair = editPair(entry as Record<string, unknown>);
      if (pair) edits.push(pair);
    }
    return edits.length ? { kind: 'edit', edits } : null;
  }
  if (name === 'Write' || name === 'write') {
    const content = o['content'];
    return typeof content === 'string' ? { kind: 'write', content } : null;
  }
  return null;
}

function elapsedMs(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return b - a;
}

/**
 * Run events → transcript blocks. Repeated tool status updates collapse into
 * one card; a tool.result merges into the tool.call that opened it. Pure, so
 * the same semantics can be golden-tested and shared with the TUI.
 */
export function runEventsToTranscript(events: readonly RunEvent[]): TranscriptBlock[] {
  const out: TranscriptBlock[] = [];
  const openTools = new Map<string, number>();
  /** Kept after a tool.result folds, so a trailing `command.executed` (Claude/Gemini/Cursor send
   * one per shell call, on top of tool.call/tool.result) can still find the row it belongs to. */
  const closedTools = new Map<string, number>();

  for (let idx = 0; idx < events.length; idx++) {
    const e = events[idx];
    if (!e) continue;
    const p = e.payload ?? {};
    switch (e.type) {
      case 'assistant.text': {
        const text = str(p['text']);
        if (!text.trim()) break;
        const last = out[out.length - 1];
        if (last && last.type === 'text' && !last.thinking) last.text += text;
        else out.push({ id: e.id, type: 'text', text });
        break;
      }
      case 'assistant.thinking': {
        const text = str(p['text']);
        if (text.trim()) {
          // No runtime reports a thinking block's own duration; the gap to the next event is the
          // closest thing derivable from what is actually recorded (design.md).
          const next = events[idx + 1];
          const thinkingDurationMs = next ? elapsedMs(e.ts, next.ts) : null;
          out.push({ id: e.id, type: 'text', text, thinking: true, thinkingDurationMs });
        }
        break;
      }
      case 'tool.call': {
        const name = str(p['name'] ?? p['tool'] ?? p['toolName'], 'tool');
        const input = p['input'] ?? p['args'] ?? p['arguments'];
        out.push({
          id: e.id,
          type: 'tool',
          tool: name,
          target: str(p['target']) || summariseInput(input),
          durationMs: null,
          adds: null,
          dels: null,
          diff: null,
          pending: true,
          editPayload: parseEditPayload(name, input),
        });
        openTools.set(callKey(p, e.id), out.length - 1);
        break;
      }
      case 'tool.result':
      case 'tool.denied': {
        const name = str(p['name'] ?? p['tool'] ?? p['toolName'], 'tool');
        const key = callKey(p, '');
        const idx = key ? openTools.get(key) : undefined;
        const block = idx != null ? out[idx] : undefined;
        const denied = e.type === 'tool.denied';
        const error = denied || p['isError'] === true;
        // The result's body is what "a compact view of its result" means; it renders collapsed.
        const detail = str(p['diff']) || resultText(p);
        if (block && block.type === 'tool') {
          block.durationMs = num(p['durationMs']);
          block.adds = num(p['additions']);
          block.dels = num(p['deletions']);
          block.diff = detail;
          block.error = error;
          block.denied = denied;
          block.pending = false;
          openTools.delete(key);
          if (key) closedTools.set(key, idx!);
        } else {
          // A result whose call we never saw (resumed session, truncated window): show it
          // anyway. Its name is often unresolved too, so preview the body instead of leaving a
          // bare fallback name as the row's only content.
          out.push({
            id: e.id,
            type: 'tool',
            tool: name,
            target: detail ? detail.slice(0, 60) : '',
            durationMs: num(p['durationMs']),
            adds: num(p['additions']),
            dels: num(p['deletions']),
            diff: detail,
            error,
            denied,
            pending: false,
          });
        }
        break;
      }
      case 'file.changed': {
        out.push({
          id: e.id,
          type: 'tool',
          tool: str(p['operation'], 'Edit'),
          target: str(p['path']),
          durationMs: null,
          adds: num(p['additions']),
          dels: num(p['deletions']),
          diff: str(p['diff']) || null,
        });
        break;
      }
      case 'command.executed': {
        const key = callKey(p, '');
        const idx = key ? openTools.get(key) ?? closedTools.get(key) : undefined;
        const block = idx != null ? out[idx] : undefined;
        const output = str(p['stdout'] ?? p['output'] ?? p['stderr']) || null;
        if (block && block.type === 'tool') {
          // The tool.call/tool.result pair for this id already rendered one row. Claude/Gemini/
          // Cursor send this event on top of that pair for every shell call, without the command
          // text, so on its own it used to render as a bare "$" row. It only backfills a gap.
          if (!block.diff && output) block.diff = output;
          break;
        }
        // No matching call in view (resumed session, truncated window): still show it, but only
        // if it carries something — a command or an output — otherwise it is truly contentless.
        const command = str(p['command']);
        if (!command && !output) break;
        out.push({ id: e.id, type: 'command', command, exitCode: num(p['exitCode']), output });
        break;
      }
      case 'run.phase.timing': {
        out.push({ id: e.id, type: 'phase', phase: str(p['phase']), durationMs: num(p['durationMs']), tokens: num(p['tokens']) });
        break;
      }
      case 'user_input.requested':
      case 'permission.requested': {
        out.push({ id: e.id, type: 'status', text: str(p['summary'], 'asked you a question'), status: 'needs-you' });
        break;
      }
      case 'plan.proposed': {
        out.push({ id: e.id, type: 'status', text: 'proposed a plan', status: 'needs-you' });
        break;
      }
      case 'error': {
        out.push({ id: e.id, type: 'status', text: str(p['message'], 'the run failed'), status: 'failed' });
        break;
      }
      case 'turn.completed': {
        const t = num(p['tokens']);
        out.push({ id: e.id, type: 'phase', phase: 'turn complete', durationMs: num(p['durationMs']), tokens: t });
        break;
      }
      case 'supervisor.action': {
        out.push({ id: e.id, type: 'status', text: str(p['action'], 'supervisor acted'), status: 'working' });
        break;
      }
      case 'human.input': {
        out.push({ id: e.id, type: 'human', text: str(p['text']), delivery: p['delivery'] === 'mid_turn' ? 'mid_turn' : 'queued' });
        break;
      }
      default:
        break;
    }
  }
  for (let i = out.length - 1; i >= 0; i--) {
    const block = out[i];
    if (!block || block.type !== 'text' || block.thinking) continue;
    const report = extractReport(block.text);
    if (report) out[i] = { id: block.id, type: 'report', report, text: block.text };
    break;
  }
  return out;
}

function summariseInput(input: unknown): string {
  if (typeof input === 'string') return input.slice(0, 120);
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    for (const k of ['file_path', 'filePath', 'path', 'pattern', 'command', 'query', 'url']) {
      const v = o[k];
      if (typeof v === 'string') return v.slice(0, 120);
    }
  }
  return '';
}
