#!/usr/bin/env node
// VS-770: start a demo daemon, capture every view in the manifest, stop the daemon.
//   pnpm demo:screenshots [--out DIR] [--only name,name] [--viewport desktop|phone] [--theme light|dark] [--url URL]
// With --url it captures an already running demo daemon and starts nothing. Otherwise it starts one on
// a free loopback port with its own throwaway config directory, records the pid, and stops exactly that pid.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const list = (v) => (v ? v.split(',') : undefined);

const bin = join(root, 'packages/server/dist/bin.js');
const capturePath = join(root, 'packages/server/dist/demo/capture.js');
if (!existsSync(capturePath)) { console.error('demo:screenshots: run `pnpm build` first'); process.exit(2); }
if (!existsSync(join(root, 'packages/ui/dist/index.html'))) { console.error('demo:screenshots: the UI is not built; run `pnpm build` first'); process.exit(2); }
const { capture } = await import(capturePath);

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});

const out = resolve(flag('out') ?? join(root, 'demo-screenshots'));
let child = null;
let scratch = null;
let baseUrl = flag('url');

async function stop() {
  if (!child || !scratch) return;
  const pid = Number(readFileSync(join(scratch, 'pid'), 'utf8'));
  // Only ever the process this script started, and only after its command line names our scratch directory.
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    if (cmd.includes(join(scratch, 'config'))) process.kill(pid, 'SIGTERM');
  } catch { /* already gone */ }
  await new Promise((r) => setTimeout(r, 500));
  rmSync(scratch, { recursive: true, force: true });
}

try {
  if (!baseUrl) {
    scratch = mkdtempSync(join(tmpdir(), 'weave-demo-shots-'));
    const port = await freePort();
    child = spawn(process.execPath, [bin, '--demo', '--config-dir', join(scratch, 'config'), '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'], detached: false });
    writeFileSync(join(scratch, 'pid'), String(child.pid));
    baseUrl = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 100 && !up; i += 1) {
      if (child.exitCode !== null) throw new Error('the demo daemon exited before it was ready');
      try { up = (await fetch(`${baseUrl}/api/health`)).ok; } catch { /* not yet */ }
      if (!up) await new Promise((r) => setTimeout(r, 200));
    }
    if (!up) throw new Error('the demo daemon did not become ready');
  }
  const results = await capture({ baseUrl, outDir: out, only: list(flag('only')), viewports: list(flag('viewport')), themes: list(flag('theme')), log: (l) => console.log(l) });
  const failed = results.filter((r) => r.errors.length > 0);
  console.log(`\n${results.length - failed.length}/${results.length} captured into ${out}`);
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await stop();
}
