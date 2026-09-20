import type { ChildMessage, ChildPartial, ChildResult } from '@weave-ai/agent';
import type { RuntimeEvent, RuntimePartial } from '@weave-ai/runtime-sdk';

/** What one stdout line from the child means to the adapter. */
export type ChildLine =
  | { kind: 'event'; ev: RuntimeEvent }
  | { kind: 'partial'; partial: RuntimePartial }
  | { kind: 'log'; level: string; text: string }
  | { kind: 'result'; result: ChildResult }
  | { kind: 'raw'; text: string };

const EVENT_TYPES = new Set(['turn.started', 'turn.completed', 'assistant.text', 'assistant.thinking', 'tool.call', 'tool.result', 'tool.denied', 'command.executed', 'file.changed', 'usage.delta', 'error', 'session.started', 'session.resumed', 'runtime.raw']);

/** Parse one line of child stdout. A line that is not a well-formed protocol message is kept as raw output, never dropped. */
export function parseChildLine(line: string): ChildLine {
  let m: ChildMessage;
  try { m = JSON.parse(line) as ChildMessage; } catch { return { kind: 'raw', text: line }; }
  if (typeof m !== 'object' || m === null) return { kind: 'raw', text: line };
  switch (m.t) {
    case 'event':
      if (!EVENT_TYPES.has(m.ev.type)) return { kind: 'event', ev: { ts: m.ev.ts, type: 'runtime.raw', payload: { originalType: m.ev.type, data: m.ev.payload } } as RuntimeEvent };
      return { kind: 'event', ev: { ts: m.ev.ts, type: m.ev.type as RuntimeEvent['type'], payload: m.ev.payload } };
    case 'partial': return { kind: 'partial', partial: toPartial(m.p) };
    case 'log': return { kind: 'log', level: m.level, text: `[${m.level}] ${m.msg}${m.fields ? ` ${JSON.stringify(m.fields)}` : ''}` };
    case 'result': return { kind: 'result', result: m.result };
    default: return { kind: 'raw', text: line };
  }
}

function toPartial(p: ChildPartial): RuntimePartial {
  return { kind: p.kind, partId: p.partId, text: p.text, ...(p.messageId ? { messageId: p.messageId } : {}), ...(p.toolCallId ? { toolCallId: p.toolCallId } : {}) };
}
