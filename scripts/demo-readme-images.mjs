#!/usr/bin/env node
// VS-771: build the README's framed light/dark split images from demo-mode screenshots.
//   pnpm demo:readme-images [--from DIR] [--out DIR] [--only name,name]
// With no --from it runs `pnpm demo:screenshots` (desktop, both themes) into a temp directory first, so
// one command regenerates every image from scratch. With --from it composes from a folder that already
// holds `<name>--desktop--light.png` and `<name>--desktop--dark.png`.
// Each image is the same page twice: light on the left, dark on the right, cut by one diagonal, with the
// two halves aligned pixel for pixel, inside a window frame on a gradient that reads on GitHub's light
// and dark themes. Pure HTML rendered by Chromium (playwright-core): no image library to install.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

/** The pages the README shows, in order. `name` is a manifest name; `title` is the frame's title bar. */
export const PAGES = [
  { name: 'chat', title: 'Weave AI — Chat with the weaver' },
  { name: 'needs', title: 'Weave AI — Needs you' },
  { name: 'work-board', title: 'Weave AI — Work board' },
  { name: 'ticket-merge-review', title: 'Weave AI — Approve and merge' },
  { name: 'ticket-in-progress', title: 'Weave AI — A ticket in progress' },
  { name: 'live', title: 'Weave AI — Live' },
  { name: 'roadmap', title: 'Weave AI — Roadmap' },
  { name: 'knowledge-graph', title: 'Weave AI — Knowledge graph' },
  { name: 'usage', title: 'Weave AI — Usage and cost' },
  { name: 'map', title: 'Weave AI — Map' },
  { name: 'changelog', title: 'Weave AI — Changelog' },
];

// Canvas and window, in CSS pixels. The shot is 1440x900 and is shown 1:1, so nothing is resampled.
const SHOT = { w: 1440, h: 900 };
const PAD = { x: 120, top: 84, bottom: 132 };
const BAR = 40;
const CANVAS = { w: SHOT.w + PAD.x * 2, h: SHOT.h + BAR + PAD.top + PAD.bottom };
// Where the diagonal cuts the top and the bottom edge, as a share of the width: light left, dark right.
const CUT = { top: 0.6, bottom: 0.4 };

function html({ title, light, dark }) {
  const { top, bottom } = CUT;
  const clip = `polygon(${top * 100}% 0, 100% 0, 100% 100%, ${bottom * 100}% 100%)`;
  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:${CANVAS.w}px;height:${CANVAS.h}px;overflow:hidden;font:600 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;
  background:radial-gradient(900px 600px at 12% 8%,#7c6cf7 0%,transparent 60%),radial-gradient(900px 700px at 92% 96%,#e0529c 0%,transparent 60%),linear-gradient(135deg,#4b3fc9,#6a3fd1 55%,#a23fb6)}
.win{position:absolute;left:${PAD.x}px;top:${PAD.top}px;width:${SHOT.w}px;height:${SHOT.h + BAR}px;border-radius:14px;overflow:hidden;
  box-shadow:0 0 0 1px rgba(255,255,255,.22),0 2px 6px rgba(10,5,40,.25),0 28px 60px rgba(10,5,40,.45),0 60px 120px rgba(10,5,40,.35);background:#111}
.bar{height:${BAR}px;display:flex;align-items:center;padding:0 16px;gap:8px;position:relative;
  background:linear-gradient(90deg,#f3f3f6 ${CUT.top * 100}%,#17171c ${CUT.top * 100}%)}
.bar i{width:12px;height:12px;border-radius:50%;display:block}
.bar .t{position:absolute;left:0;right:0;text-align:center;color:#6b6b76;font-weight:600;pointer-events:none}
.stage{position:relative;width:${SHOT.w}px;height:${SHOT.h}px}
.stage img{position:absolute;left:0;top:0;width:${SHOT.w}px;height:${SHOT.h}px;display:block}
.dark{clip-path:${clip}}
svg{position:absolute;left:0;top:0}
.tag{position:absolute;bottom:18px;padding:7px 12px;border-radius:999px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;backdrop-filter:blur(6px)}
.tag.l{left:18px;background:rgba(255,255,255,.88);color:#23232b;box-shadow:0 0 0 1px rgba(0,0,0,.12)}
.tag.d{right:18px;background:rgba(20,20,26,.88);color:#f2f2f6;box-shadow:0 0 0 1px rgba(255,255,255,.18)}
</style>
<div class="win">
  <div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span class="t">${title}</span></div>
  <div class="stage">
    <img src="${light}"><img class="dark" src="${dark}">
    <svg width="${SHOT.w}" height="${SHOT.h}"><line x1="${top * SHOT.w}" y1="0" x2="${bottom * SHOT.w}" y2="${SHOT.h}" stroke="rgba(255,255,255,.9)" stroke-width="2"/></svg>
    <span class="tag l">Light</span><span class="tag d">Dark</span>
  </div>
</div>`;
}

async function launch() {
  const explicit = process.env.CHROME_PATH;
  if (explicit) return chromium.launch({ executablePath: explicit, args: ['--no-sandbox'] });
  try { return await chromium.launch({ args: ['--no-sandbox'] }); } catch (first) {
    for (const c of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
      if (existsSync(c)) return chromium.launch({ executablePath: c, args: ['--no-sandbox'] });
    }
    throw first;
  }
}

const out = resolve(flag('out') ?? join(root, 'docs/images/readme'));
const only = flag('only')?.split(',');
const pages = PAGES.filter((p) => !only || only.includes(p.name));
let from = flag('from') ? resolve(flag('from')) : null;
let scratch = null;

if (!from) {
  scratch = mkdtempSync(join(tmpdir(), 'weave-readme-shots-'));
  from = scratch;
  const r = spawnSync(process.execPath, [join(root, 'scripts/demo-screenshots.mjs'), '--out', from, '--viewport', 'desktop', '--only', pages.map((p) => p.name).join(',')], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('demo:readme-images: the capture failed'); process.exit(r.status ?? 1); }
}

mkdirSync(out, { recursive: true });
const frames = mkdtempSync(join(tmpdir(), 'weave-readme-frames-'));
const browser = await launch();
let total = 0;
try {
  const page = await browser.newPage({ viewport: { width: CANVAS.w, height: CANVAS.h }, deviceScaleFactor: 1 });
  for (const p of pages) {
    const light = join(from, `${p.name}--desktop--light.png`);
    const dark = join(from, `${p.name}--desktop--dark.png`);
    for (const f of [light, dark]) if (!existsSync(f)) { console.error(`demo:readme-images: missing ${f}`); process.exit(2); }
    // A file the page loads by URL, not inline: two PNGs as data URLs make a page too big for setContent.
    const file = join(frames, `${p.name}.html`);
    writeFileSync(file, html({ title: p.title, light: pathToFileURL(light).href, dark: pathToFileURL(dark).href }));
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
    const target = join(out, `${p.name}.jpg`);
    await page.screenshot({ path: target, type: 'jpeg', quality: 86 });
    const kb = Math.round(statSync(target).size / 1024);
    total += kb;
    console.log(`ok   ${p.name}.jpg  ${kb} KB`);
  }
} finally {
  await browser.close();
  rmSync(frames, { recursive: true, force: true });
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
console.log(`\n${pages.length} images into ${out} (${(total / 1024).toFixed(1)} MB)`);
