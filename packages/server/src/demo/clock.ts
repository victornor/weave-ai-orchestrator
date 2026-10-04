/**
 * VS-770: the demo's fixed "now". Every seeded timestamp is this instant minus an offset, so two
 * seeds produce the same bytes and a screenshot run can pin the browser clock to the same instant.
 */
export const DEMO_NOW_ISO = '2026-03-02T14:30:00.000Z';
export const DEMO_NOW_MS = Date.parse(DEMO_NOW_ISO);

/** The ISO timestamp `minutes` before the demo's now (negative: after it). */
export const ago = (minutes: number): string => new Date(DEMO_NOW_MS - minutes * 60_000).toISOString();

/** `hours` before the demo's now. */
export const hoursAgo = (hours: number): string => ago(hours * 60);

/** `days` before the demo's now. */
export const daysAgo = (days: number): string => ago(days * 24 * 60);

/**
 * Makes this process believe it is the demo's "now" at the moment this runs, and lets time pass from
 * there. The daemon computes its own windows (usage ranges, "stalled for", next fire times) from the
 * clock, so a seed dated March 2026 would fall outside every "last 7 days" view on any other day.
 * Called once by the demo entry point before anything reads the time; never by the real daemon.
 */
export function installDemoClock(): void {
  const RealDate = Date;
  const offset = DEMO_NOW_MS - RealDate.now();
  class DemoDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...(args as [number]));
    }
    static override now(): number { return RealDate.now() + offset; }
  }
  globalThis.Date = DemoDate as unknown as DateConstructor;
}
