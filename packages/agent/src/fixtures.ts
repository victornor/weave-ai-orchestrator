import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SseParser } from './sse.js';
import { StreamReducer, type StepResult } from './codec/chatCompletions.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
export const fixtureNames = (): string[] => readdirSync(dir).filter((f) => f.endsWith('.sse')).sort();
export const readFixture = (name: string): Buffer => readFileSync(join(dir, name));

/** Feed `bytes` to the parser in the given pieces and fold the events through the reducer. Test and harness helper. */
export function assemble(pieces: Uint8Array[]): StepResult {
  const parser = new SseParser();
  const reducer = new StreamReducer();
  const handle = (events: Array<{ data: string }>): void => { for (const e of events) { if (e.data === '[DONE]') continue; try { reducer.push(JSON.parse(e.data)); } catch { /* not JSON */ } } };
  for (const p of pieces) handle(parser.feed(p));
  handle(parser.end());
  return reducer.result();
}
