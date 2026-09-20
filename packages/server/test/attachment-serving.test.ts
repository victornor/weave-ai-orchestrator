/** VS-597: the ticket-attachment route's headers, ranges, HEAD, ETag, hostile labels and octet-stream detection. */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { authed, makeHarness, type Harness } from './fakes.js';

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.from([0, 0, 2, 0]), Buffer.alloc(984, 7)]); // 1000 bytes
let harness: Harness | null = null;
let root: string | null = null;
afterEach(async () => {
  await harness?.close(); harness = null;
  if (root) rmSync(root, { recursive: true, force: true }); root = null;
});

/** Stores `bytes` and registers an attachment row whose `byteSize` deliberately may lie. */
function serve(bytes: Buffer, over: { label?: string; mediaType?: string; byteSize?: number } = {}) {
  harness = makeHarness();
  const h = harness;
  root = mkdtempSync(join(tmpdir(), 'ac-attachment-serving-'));
  const dir = join(root, 'attachments');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'stored.bin'), bytes);
  (h.runtime.ctx.paths as { attachments: string }).attachments = dir;
  const row = {
    id: 'att_1', ticketId: 'tk_1', label: over.label ?? 'clip', mediaType: over.mediaType ?? 'application/octet-stream',
    byteSize: over.byteSize ?? bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'),
    storageKey: 'stored.bin', createdAt: '2026-09-20T00:00:00.000Z',
  };
  h.impls.tickets!['attachment'] = () => row;
  return (init: RequestInit & { query?: string } = {}) =>
    createApp(h.deps).fetch(new Request(`http://127.0.0.1:7433/api/w/ws1/tickets/tk_1/attachments/att_1${init.query ?? ''}`, { ...init, headers: { ...authed(), ...(init.headers as Record<string, string>) } }));
}

describe('GET /tickets/:id/attachments/:attachmentId (VS-597)', () => {
  it('sends the length of the bytes served, not the stored byteSize', async () => {
    const get = serve(MP4, { byteSize: 14 });
    const res = await get();
    const body = Buffer.from(await res.arrayBuffer());
    expect(res.headers.get('content-length')).toBe(String(MP4.byteLength));
    expect(body.byteLength).toBe(MP4.byteLength);
  });

  it('refines a stored octet-stream MP4 to video/mp4 and names it with an extension', async () => {
    const get = serve(MP4, { label: 'Rendered fast-1080p output (720p 24fps source -> 1920x1080, audio kept)' });
    const res = await get();
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    const cd = res.headers.get('content-disposition')!;
    expect(cd).toContain('filename="Rendered fast-1080p output (720p 24fps source -> 1920x1080, audio kept).mp4"');
    expect(cd).toContain("filename*=UTF-8''Rendered%20fast-1080p%20output%20%28720p%2024fps%20source%20-%3E%201920x1080%2C%20audio%20kept%29.mp4");
  });

  it('survives a non-Latin-1 and hostile label instead of throwing', async () => {
    const get = serve(MP4, { label: 'vidéo "日本語"\\x.mp4' });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''vid%C3%A9o%20%22%E6%97%A5%E6%9C%AC%E8%AA%9E%22%5Cx.mp4");
    expect(res.headers.get('content-disposition')).toMatch(/filename="[\x20-\x7e]*"/);
  });

  it('answers a range with 206 and the exact slice', async () => {
    const get = serve(MP4);
    const res = await get({ headers: { range: 'bytes=0-99' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-99/1000');
    expect(res.headers.get('content-length')).toBe('100');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(MP4.subarray(0, 100));
    const open = await get({ headers: { range: 'bytes=900-' } });
    expect(open.headers.get('content-range')).toBe('bytes 900-999/1000');
    const suffix = await get({ headers: { range: 'bytes=-10' } });
    expect(Buffer.from(await suffix.arrayBuffer())).toEqual(MP4.subarray(990));
  });

  it('answers an unsatisfiable range with 416', async () => {
    const get = serve(MP4);
    const res = await get({ headers: { range: 'bytes=5000-' } });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */1000');
  });

  it('answers HEAD with the GET headers and no body', async () => {
    const get = serve(MP4);
    const res = await get({ method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('1000');
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it('gives a stable ETag and 304s a matching If-None-Match', async () => {
    const get = serve(MP4);
    const etag = (await get()).headers.get('etag')!;
    expect(etag).toBe(`"${createHash('sha256').update(MP4).digest('hex')}"`);
    const again = await get({ headers: { 'if-none-match': etag } });
    expect(again.status).toBe(304);
  });

  it('ignores a range whose If-Range no longer matches', async () => {
    const get = serve(MP4);
    const res = await get({ headers: { range: 'bytes=0-9', 'if-range': '"other"' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('1000');
  });

  it('serves a PDF inline only when asked, and never an svg', async () => {
    const pdf = Buffer.from('%PDF-1.7 hello');
    const get = serve(pdf, { label: 'report' });
    expect((await get()).headers.get('content-disposition')).toMatch(/^attachment;/);
    expect((await get({ query: '?inline=1' })).headers.get('content-disposition')).toMatch(/^inline; filename="report.pdf"/);
    const svg = serve(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { mediaType: 'image/svg+xml', label: 'x.svg' });
    const r = await svg({ query: '?inline=1' });
    expect(r.headers.get('content-disposition')).toMatch(/^attachment;/);
  });
});
