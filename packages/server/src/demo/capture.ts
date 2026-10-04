import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { DEMO_NOW_MS } from './clock.js';
import { PRIMARY_WORKSPACE, SHOTS, THEMES, VIEWPORTS, type ShotSpec, type ThemeName, type ViewportName } from './manifest.js';

export interface CaptureOptions {
  /** Base URL of a running demo daemon. */
  baseUrl: string;
  /** Where the PNGs go. Created if missing. */
  outDir: string;
  /** Only these shot names; default: the whole manifest. */
  only?: string[];
  viewports?: ViewportName[];
  themes?: ThemeName[];
  /** Write nothing; just load every page and report errors. */
  check?: boolean;
  log?: (line: string) => void;
}

export interface ShotResult { name: string; viewport: ViewportName; theme: ThemeName; file: string | null; errors: string[] }

/** Chromium: `CHROME_PATH` if set, else Playwright's own download, else a system install. */
async function launch(): Promise<Browser> {
  const explicit = process.env['CHROME_PATH'];
  if (explicit) return chromium.launch({ executablePath: explicit, args: ['--no-sandbox'] });
  try { return await chromium.launch({ args: ['--no-sandbox'] }); }
  catch (first) {
    for (const candidate of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
      if (existsSync(candidate)) return chromium.launch({ executablePath: candidate, args: ['--no-sandbox'] });
    }
    throw first;
  }
}

const urlOf = (base: string, shot: ShotSpec): string => `${base.replace(/\/$/, '')}${shot.path.replace('{ws}', PRIMARY_WORKSPACE)}`;

/**
 * Console noise the app produces for reasons unrelated to the demo: a stream we deliberately fail, and
 * the browser's own report of a blocked request.
 */
const expectedNoise = (shot: ShotSpec, text: string): boolean => !!shot.blockStreams && /Failed to load resource|net::ERR|EventSource|503/i.test(text);

export async function capture(opts: CaptureOptions): Promise<ShotResult[]> {
  const log = opts.log ?? (() => undefined);
  const shots = SHOTS.filter((s) => !opts.only || opts.only.includes(s.name));
  const names = new Set<string>();
  for (const s of SHOTS) { if (names.has(s.name)) throw new Error(`duplicate manifest name: ${s.name}`); names.add(s.name); }
  if (!opts.check) mkdirSync(opts.outDir, { recursive: true });
  const browser = await launch();
  const results: ShotResult[] = [];
  try {
    for (const viewport of opts.viewports ?? (Object.keys(VIEWPORTS) as ViewportName[])) {
      for (const theme of opts.themes ?? [...THEMES]) {
        const context = await browser.newContext({ viewport: { width: VIEWPORTS[viewport].width, height: VIEWPORTS[viewport].height }, deviceScaleFactor: VIEWPORTS[viewport].deviceScaleFactor, isMobile: VIEWPORTS[viewport].isMobile, hasTouch: VIEWPORTS[viewport].hasTouch, colorScheme: theme, reducedMotion: 'reduce' });
        // The browser's clock starts at the demo's "now" and then runs, so "3 minutes ago" reads the same on
        // every capture. A frozen clock (Playwright's `setFixedTime`) would stall every time-based animation,
        // including the graph layouts that settle by easing.
        await context.addInitScript(({ t, ws, now }) => {
          try { localStorage.setItem('weave.v2.theme', t); localStorage.setItem('conductor.ws', ws); } catch { /* ignore */ }
          const RealDate = Date;
          const offset = now - RealDate.now();
          class DemoDate extends RealDate {
            constructor(...args: unknown[]) {
              if (args.length === 0) super(RealDate.now() + offset);
              else super(...(args as [number]));
            }
            static override now(): number { return RealDate.now() + offset; }
          }
          (globalThis as { Date: DateConstructor }).Date = DemoDate as unknown as DateConstructor;
        }, { t: theme, ws: PRIMARY_WORKSPACE, now: DEMO_NOW_MS });
        for (const shot of shots) {
          if (shot.viewports && !shot.viewports.includes(viewport)) continue;
          const page = await context.newPage();
          const errors: string[] = [];
          page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
          // A failed resource names no URL in the console, so the response is what says which one it was.
          page.on('response', (r) => { if (r.status() >= 400 && !shot.blockStreams) errors.push(`http ${r.status()}: ${r.request().method()} ${r.url().replace(opts.baseUrl, '')}`); });
          page.on('console', (m) => { if (m.type() === 'error' && !expectedNoise(shot, m.text()) && !/Failed to load resource/i.test(m.text())) errors.push(`console: ${m.text()}`); });
          if (shot.blockStreams) await page.route(/\/(events|stream)(\?|$|\/)/, (route) => route.fulfill({ status: 503, body: 'offline' }));
          const file = join(opts.outDir, `${shot.name}--${viewport}--${theme}.png`);
          try {
            await page.goto(urlOf(opts.baseUrl, shot), { waitUntil: 'domcontentloaded' });
            await page.waitForSelector(shot.ready ?? '.v2-root', { timeout: 20_000 });
            await page.waitForLoadState('load');
            await page.waitForTimeout(shot.settleMs ?? 900);
            for (const sel of shot.click ?? []) { await page.click(sel); await page.waitForTimeout(300); }
            if (!opts.check) await page.screenshot({ path: file, fullPage: shot.fullPage ?? false, animations: 'disabled' });
          } catch (e) {
            errors.push(`capture: ${e instanceof Error ? e.message : String(e)}`);
          }
          await page.close();
          results.push({ name: shot.name, viewport, theme, file: opts.check ? null : file, errors });
          log(`${errors.length ? 'FAIL' : 'ok  '} ${shot.name} ${viewport} ${theme}${errors.length ? `\n      ${errors.join('\n      ')}` : ''}`);
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}
