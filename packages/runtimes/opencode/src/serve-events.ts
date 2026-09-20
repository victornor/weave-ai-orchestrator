/**
 * Translator for `opencode serve`'s `GET /event` stream (VS-595).
 *
 * `opencode run --format json` prints a part only when it is complete; the server's event stream
 * carries the part while it is generated. Shapes below are from recorded bytes
 * (`fixtures/serve-*.jsonl`, opencode 1.18.31), not from the docs:
 *
 *   message.updated       {info:{id, role, finish?, tokens?, time}}   — assistant messages only are used
 *   message.part.updated  {part:{id, type, messageID, ...}}           — text/reasoning (time.end = done),
 *                          tool (state pending → running{input} → completed{output,metadata}),
 *                          step-start, step-finish{reason,tokens,cost}
 *   message.part.delta    {messageID, partID, field:'text', delta}    — the appended fragment
 *   session.status        {status:{type: busy | idle | retry{attempt,message,next}}}
 *   session.idle          {sessionID}                                 — the turn is over
 *   session.error         {sessionID, error:{name, data:{message}}}
 *   permission.asked      {id, sessionID, permission, patterns, tool}
 *
 * Completed parts are handed to the `run --format json` parser (same fields, same usage/cost/state
 * accounting), so both drivers produce identical persisted events; this adds the tool call at its
 * start, the deltas as partials, and the permission and end-of-turn signals.
 */
import type { RuntimeEvent, RuntimePartial } from '@weave-ai/runtime-sdk';
import { createOpenCodeParser, toolEvents } from './events.js';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export interface ServeStep {
  events: RuntimeEvent[];
  partials: RuntimePartial[];
  /** A permission the server is waiting on. */
  permission?: { id: string; permission: string | null; patterns: string[] };
  /** The session went idle: the turn is over. */
  idle?: boolean;
}

export function createOpenCodeServeTranslator(opts: { resumed: boolean; sessionId: string }) {
  const legacy = createOpenCodeParser({ resumed: opts.resumed });
  const assistantMessages = new Set<string>();
  const partTypes = new Map<string, string>();
  const doneParts = new Set<string>();
  const calledTools = new Set<string>();
  /** The first event from the server for this session, i.e. the stream is really ours and alive. */
  let sawSession = false;

  const feed = (type: string, sessionID: string, part: Json | null, extra: Json = {}): RuntimeEvent[] =>
    legacy.handle(JSON.stringify({ type, timestamp: Date.now(), sessionID, part, ...extra }));

  function handle(evt: Json): ServeStep {
    const out: ServeStep = { events: [], partials: [] };
    const type = str(evt['type']);
    const props = obj(evt['properties']);
    if (!type || !props) return out;
    const part = obj(props['part']);
    const sid = str(props['sessionID']) ?? str(part?.['sessionID']) ?? str(obj(props['info'])?.['sessionID']);
    if (sid !== opts.sessionId) return out;
    if (!sawSession) { sawSession = true; out.events.push(...feed('__session', sid, null).filter((e) => e.type === 'session.started' || e.type === 'session.resumed')); }
    const ts = new Date().toISOString();

    switch (type) {
      case 'message.updated': {
        const info = obj(props['info']);
        if (info && str(info['role']) === 'assistant' && str(info['id'])) assistantMessages.add(str(info['id'])!);
        break;
      }
      case 'message.part.updated': {
        if (!part) break;
        const id = str(part['id']) ?? '';
        const kind = str(part['type']) ?? '';
        if (!assistantMessages.has(str(part['messageID']) ?? '')) break;
        partTypes.set(id, kind);
        if (kind === 'step-start') out.events.push(...feed('step_start', sid, part));
        else if (kind === 'step-finish') { if (!doneParts.has(id)) { doneParts.add(id); out.events.push(...feed('step_finish', sid, part)); } }
        else if (kind === 'text' || kind === 'reasoning') {
          if (obj(part['time'])?.['end'] != null && !doneParts.has(id)) { doneParts.add(id); out.events.push(...feed(kind, sid, part)); }
        } else if (kind === 'tool') {
          const st = obj(part['state']);
          const status = str(st?.['status']);
          const callId = str(part['callID']) ?? id;
          if (status === 'running' || status === 'completed' || status === 'error') {
            const first = !calledTools.has(callId);
            calledTools.add(callId);
            if (status === 'running') { if (first) out.events.push(...toolEvents(part, ts, true)); }
            else if (!doneParts.has(id)) { doneParts.add(id); out.events.push(...toolEvents(part, ts, first)); }
          }
        }
        break;
      }
      case 'message.part.delta': {
        const partId = str(props['partID']);
        const delta = str(props['delta']);
        const kind = partId ? partTypes.get(partId) : undefined;
        if (!partId || !delta || str(props['field']) !== 'text') break;
        if (kind === 'text' || kind === 'reasoning') out.partials.push({ kind: kind === 'text' ? 'text' : 'thinking', partId, messageId: str(props['messageID']) ?? undefined, text: delta });
        break;
      }
      case 'session.status': {
        const status = obj(props['status']);
        if (str(status?.['type']) === 'retry') out.events.push({ ts, type: 'runtime.raw', payload: { originalType: 'session.status.retry', data: status } });
        break;
      }
      case 'session.idle':
        out.idle = true;
        break;
      case 'session.error':
        out.events.push(...feed('error', sid, null, { error: props['error'] }));
        break;
      case 'permission.asked': {
        const id = str(props['id']);
        if (id) out.permission = { id, permission: str(props['permission']), patterns: Array.isArray(props['patterns']) ? (props['patterns'] as unknown[]).filter((p): p is string => typeof p === 'string') : [] };
        break;
      }
      default:
        break;
    }
    return out;
  }

  return { state: legacy.state, handle, finish: legacy.finish, get sessionAnnounced() { return legacy.sessionAnnounced; } };
}
