const WINDOW = 3;

interface Entry { key: string; result: string }

/**
 * Stops a model that repeats itself. After three identical calls (same name, same arguments, same
 * result) a fourth is refused once with a corrective result; if it comes again the turn is stopped.
 * A different call in between resets the guard.
 */
export class DoomGuard {
  private history: Entry[] = [];
  private warned = false;

  static key(name: string, args: unknown): string { return `${name}|${canonical(args)}`; }

  /** Decide before running a call. A `warn` or `stop` call must not run and must not be `record`ed. */
  check(key: string): 'ok' | 'warn' | 'stop' {
    const tail = this.history.slice(-WINDOW);
    const looping = tail.length === WINDOW && tail.every((e) => e.key === key && e.result === tail[0]!.result);
    if (!looping) return 'ok';
    if (this.warned) return 'stop';
    this.warned = true;
    return 'warn';
  }

  record(key: string, result: string): void {
    this.history.push({ key, result });
    if (this.history.length > WINDOW * 2) this.history.shift();
    this.warned = false;
  }
}

/** JSON with sorted keys, so argument order never hides a repeat. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object' && v !== null) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}
