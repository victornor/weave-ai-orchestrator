// A fake `opencode` for tests: `serve` speaks just enough of the server API to replay a recorded
// event stream (fixtures/serve-*.jsonl) for the session the driver asks about. Every request it
// receives is appended to $FAKE_LOG as `METHOD path body`. Nothing here is the real CLI.
import http from 'node:http';
import { appendFileSync, readFileSync } from 'node:fs';

if (process.argv[2] !== 'serve') { process.stderr.write('fake opencode: only serve\n'); process.exit(2); }
const fixture = readFileSync(process.env.FAKE_FIXTURE, 'utf8').split('\n').filter(Boolean);
const cut = process.env.FAKE_CUT ? Number(process.env.FAKE_CUT) : fixture.length;
const hang = process.env.FAKE_HANG === '1';
const log = (s) => appendFileSync(process.env.FAKE_LOG, s + '\n');
const fixtureSession = JSON.parse(fixture[0]).properties.sessionID ?? JSON.parse(fixture[0]).properties.part.sessionID;
let stream = null;
let session = 'ses_fake_new';

function replay() {
  const lines = fixture.slice(0, cut).map((l) => l.split(fixtureSession).join(session));
  let i = 0;
  const tick = () => {
    if (!stream || i >= lines.length) { if (!hang && stream) stream.end(); return; }
    stream.write(`data: ${lines[i++]}\n\n`);
    setTimeout(tick, 2);
  };
  tick();
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    log(`${req.method} ${url.pathname} ${body}`);
    if (req.method === 'POST' && url.pathname === '/session') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ id: session })); }
    if (req.method === 'GET' && url.pathname === '/event') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      stream = res;
      res.write('data: {"id":"evt_0","type":"server.connected","properties":{}}\n\n');
      return;
    }
    const m = /^\/session\/([^/]+)\/prompt_async$/.exec(url.pathname);
    if (req.method === 'POST' && m) { session = decodeURIComponent(m[1]); res.writeHead(204); res.end(); return replay(); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('true');
  });
});
server.listen(0, '127.0.0.1', () => { process.stdout.write(`opencode server listening on http://127.0.0.1:${server.address().port}\n`); });
process.on('SIGTERM', () => process.exit(0));
