import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A fake `codex` whose `app-server` speaks scripted JSON-RPC over stdio. Every client message is
 * appended to `log` (JSONL) so a test can assert what the driver sent and how it answered requests.
 * `scenario` picks the script; `replay` plays back a recorded fixture (`{ms, dir, m}` lines): each
 * client request is answered by the next recorded response, and after `turn/start` every recorded
 * server notification follows.
 */
export type AppServerScenario = 'stream' | 'approval' | 'cutoff' | 'hang' | 'reject_turn' | 'reject_thread' | 'exit' | 'replay';

export function writeFakeAppServer(scenario: AppServerScenario, opts: { replay?: string } = {}): { dir: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fake-app-server-'));
  const log = join(dir, 'client.jsonl');
  writeFileSync(join(dir, 'replay.jsonl'), opts.replay ? readFileSync(opts.replay, 'utf8') : '');
  writeFileSync(join(dir, 'codex'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] !== 'app-server') { process.stderr.write('exec path reached\\n'); fs.writeFileSync(${JSON.stringify(join(dir, 'exec-ran'))}, args.join(' ')); process.exit(9); }
fs.writeFileSync(${JSON.stringify(join(dir, 'argv.json'))}, JSON.stringify(args));
const scenario = ${JSON.stringify(scenario)};
const log = (m) => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(m) + '\\n');
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
const TH = 'thread-1', TU = 'turn-1';
const note = (method, params) => send({ method, params: { threadId: TH, turnId: TU, ...params } });
if (scenario === 'exit') { process.stderr.write('no such subcommand\\n'); process.exit(2); }
const recorded = fs.readFileSync(${JSON.stringify(join(dir, 'replay.jsonl'))}, 'utf8').split('\\n').filter(Boolean).map(JSON.parse);
const responses = recorded.filter((e) => e.dir === '<' && e.m.id !== undefined && e.m.method === undefined).map((e) => e.m);
const notes = recorded.filter((e) => e.dir === '<' && e.m.method !== undefined).map((e) => e.m);
let replied = 0;
const item = (o) => ({ threadId: TH, turnId: TU, ...o });
const command = { type: 'commandExecution', id: 'c1', command: 'ls', cwd: '/w', status: 'inProgress', aggregatedOutput: null, exitCode: null };
async function turn() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  note('turn/started', { turn: { id: TU, status: 'inProgress' } });
  if (scenario === 'stream' || scenario === 'approval') {
    note('item/started', { item: command });
    note('item/commandExecution/outputDelta', { itemId: 'c1', delta: 'a\\n' });
    await wait(20);
    note('item/commandExecution/outputDelta', { itemId: 'c1', delta: 'b\\n' });
    note('item/completed', { item: { ...command, status: 'completed', aggregatedOutput: 'a\\nb\\n', exitCode: 0 } });
  }
  if (scenario === 'approval') {
    send({ id: 7, method: 'item/commandExecution/requestApproval', params: { threadId: TH, turnId: TU, itemId: 'c2' } });
    send({ id: 8, method: 'mcpServer/elicitation/request', params: { threadId: TH, serverName: 'weave-ai', message: 'ok?' } });
    send({ id: 9, method: 'mcpServer/elicitation/request', params: { threadId: TH, serverName: 'other', message: 'ok?' } });
    send({ id: 10, method: 'item/tool/call', params: { threadId: TH } });
    await wait(200);
  }
  if (scenario === 'stream' || scenario === 'approval') {
    note('item/started', { item: { type: 'agentMessage', id: 'm1', text: '' } });
    note('item/agentMessage/delta', { itemId: 'm1', delta: 'Do' });
    note('item/agentMessage/delta', { itemId: 'm1', delta: 'ne' });
    note('item/completed', { item: { type: 'agentMessage', id: 'm1', text: 'Done' } });
    note('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 10, totalTokens: 120 }, last: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 10, totalTokens: 120 } } });
    note('turn/completed', { turn: { id: TU, status: 'completed', error: null } });
  }
  if (scenario === 'cutoff') {
    note('item/started', { item: { type: 'agentMessage', id: 'm1', text: '' } });
    note('item/agentMessage/delta', { itemId: 'm1', delta: 'par' });
    await wait(30);
    process.stderr.write('stream ended: connection reset\\n');
    process.exit(1);
  }
  if (scenario === 'hang') {
    note('item/started', { item: { type: 'agentMessage', id: 'm1', text: '' } });
    note('item/agentMessage/delta', { itemId: 'm1', delta: 'thinking' });
  }
}
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    log(m);
    if (m.id !== undefined && m.method === undefined) continue; // a reply to one of our requests
    if (m.id === undefined) continue; // initialized
    if (scenario === 'replay') {
      send(responses[replied++]);
      if (m.method === 'turn/start') { (async () => { for (const n of notes) { if (n.method === 'thread/started' || n.method === 'remoteControl/status/changed') continue; send(n); await new Promise((r) => setTimeout(r, 1)); } })(); }
      continue;
    }
    if (m.method === 'initialize') send({ id: m.id, result: { userAgent: 'fake', codexHome: '/h' } });
    else if (m.method === 'thread/start' || m.method === 'thread/resume' || m.method === 'thread/fork') {
      if (scenario === 'reject_thread') send({ id: m.id, error: { code: -32000, message: 'no trust' } });
      else send({ id: m.id, result: { thread: { id: m.method === 'thread/resume' ? m.params.threadId : m.method === 'thread/fork' ? 'forked-thread' : TH } } });
    } else if (m.method === 'turn/start') {
      if (scenario === 'reject_turn') send({ id: m.id, error: { code: -32000, message: 'busy' } });
      else { send({ id: m.id, result: { turn: { id: TU, status: 'inProgress' } } }); turn(); }
    } else if (m.method === 'turn/interrupt') {
      send({ id: m.id, result: {} });
      note('turn/completed', { turn: { id: TU, status: 'interrupted', error: null } });
    }
  }
});
`);
  chmodSync(join(dir, 'codex'), 0o755);
  return { dir, log };
}
