import type { RunEvent } from '@agent-conductor/shared';

export type TranscriptBlock =
  | { id: string; type: 'text'; text: string; thinking?: boolean }
  | { id: string; type: 'tool'; tool: string; target: string; durationMs: number | null; adds: number | null; dels: number | null; diff: string | null; error?: boolean; pending?: boolean; denied?: boolean }
  | { id: string; type: 'phase'; phase: string; durationMs: number | null; tokens: number | null }
  | { id: string; type: 'status'; text: string; status: 'needs-you' | 'blocked' | 'failed' | 'done' | 'working' }
  | { id: string; type: 'command'; command: string; exitCode: number | null; output: string | null }
  | { id: string; type: 'human'; text: string; delivery: 'mid_turn' | 'queued' };

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

/**
 * Run events → transcript blocks. Repeated tool status updates collapse into
 * one card; a tool.result merges into the tool.call that opened it. Pure, so
 * the same semantics can be golden-tested and shared with the TUI.
 */
export function runEventsToTranscript(events: readonly RunEvent[]): TranscriptBlock[] {
  const out: TranscriptBlock[] = [];
  const openTools = new Map<string, number>();

  for (const e of events) {
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
        if (text.trim()) out.push({ id: e.id, type: 'text', text, thinking: true });
        break;
      }
      case 'tool.call': {
        const name = str(p['name'] ?? p['tool'] ?? p['toolName'], 'tool');
        out.push({
          id: e.id,
          type: 'tool',
          tool: name,
          target: str(p['target']) || summariseInput(p['input'] ?? p['args'] ?? p['arguments']),
          durationMs: null,
          adds: null,
          dels: null,
          diff: null,
          pending: true,
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
        } else {
          // A result whose call we never saw (resumed session, truncated window): show it anyway.
          out.push({
            id: e.id,
            type: 'tool',
            tool: name,
            target: '',
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
        out.push({ id: e.id, type: 'command', command: str(p['command']), exitCode: num(p['exitCode']), output: str(p['output']) || null });
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
  return out;
}

function summariseInput(input: unknown): string {
  if (typeof input === 'string') return input.slice(0, 120);
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    for (const k of ['file_path', 'path', 'pattern', 'command', 'query', 'url']) {
      const v = o[k];
      if (typeof v === 'string') return v.slice(0, 120);
    }
  }
  return '';
}
