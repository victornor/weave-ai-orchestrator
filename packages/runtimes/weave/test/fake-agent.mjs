#!/usr/bin/env node
// A stand-in for the agent child: records what it was started with, then plays a scenario chosen by
// the prompt. It speaks the same NDJSON protocol as packages/agent's bin.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const rl = createInterface({ input: process.stdin });
let started = false;
let initMsg = null;
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.type === 'cancel') return finishCancelled();
  // Live input (S7): record each `send`; the `hold` scenario ends when it receives `finish`.
  if (m.type === 'send') {
    if (!initMsg) return;
    appendFileSync(initMsg.run.cwd + '/sends.jsonl', `${m.text}\n`);
    if (m.text === 'finish') { out({ t: 'event', ev: { ts: new Date().toISOString(), type: 'assistant.text', payload: { text: 'steered' } } }); out({ t: 'result', result: { exitCode: 0, signal: null, timedOut: false, session: initMsg.session, finalText: 'steered' } }); process.exit(0); }
    return;
  }
  if (m.type !== 'init' || started) return;
  started = true;
  initMsg = m;
  const record = { pid: process.pid, ppid: process.ppid, pgid: Number(readFileSync('/proc/self/stat', 'utf8').split(') ')[1].split(' ')[2]), argv: process.argv, env: process.env, init: m };
  writeFileSync(m.run.cwd + '/record.json', JSON.stringify(record));
  if (process.argv.includes('--compact')) {
    out({ t: 'result', result: { exitCode: 0, signal: null, timedOut: false, session: m.session, finalText: null, compaction: { ok: true, tokensBefore: 100, tokensAfter: 10 } } });
    process.exit(0);
  }
  const scenario = m.prompt;
  if (scenario === 'replay') {
    for (const l of readFileSync(new URL('./fixtures/tool-turn.ndjson', import.meta.url), 'utf8').split('\n')) if (l.trim()) process.stdout.write(l + '\n');
    process.exit(0);
  }
  if (scenario === 'crash') { process.stderr.write('boom: something broke\n'); process.exit(1); }
  if (scenario === 'structured') { out({ t: 'result', result: { exitCode: 0, signal: null, timedOut: false, session: m.session, finalText: null, structured: { ok: true } } }); process.exit(0); }
  if (scenario === 'quota') { out({ t: 'event', ev: { ts: new Date().toISOString(), type: 'error', payload: { code: 'quota_exhausted', family: 'provider_quota', message: 'Insufficient Balance' } } }); out({ t: 'result', result: { exitCode: 1, signal: null, timedOut: false, session: null, finalText: null, error: { code: 'rate_limited', family: 'transient_upstream', message: 'slow down', retryAfterMs: 90000, status: 429 } } }); process.exit(1); }
  if (scenario === 'sigkill') process.kill(process.pid, 'SIGKILL');
  if (scenario === 'hang') { out({ t: 'event', ev: { ts: new Date().toISOString(), type: 'turn.started', payload: {} } }); return; }
  if (scenario === 'hold') { out({ t: 'event', ev: { ts: new Date().toISOString(), type: 'turn.started', payload: {} } }); return; }
  if (scenario === 'noise') { process.stdout.write('not json at all\n'); out({ t: 'log', level: 'warn', msg: 'careful', fields: { a: 1 } }); out({ t: 'event', ev: { ts: new Date().toISOString(), type: 'mystery.thing', payload: { x: 1 } } }); out({ t: 'result', result: { exitCode: 0, signal: null, timedOut: false, session: null, finalText: 'ok' } }); process.exit(0); }
});
function finishCancelled() {
  out({ t: 'result', result: { exitCode: 143, signal: 'SIGTERM', timedOut: false, session: { v: 1, id: 's', path: '/p', leafId: null }, finalText: null } });
  process.exit(143);
}
process.on('SIGINT', finishCancelled);
process.on('SIGTERM', finishCancelled);
rl.on('close', () => { if (started) finishCancelled(); });
