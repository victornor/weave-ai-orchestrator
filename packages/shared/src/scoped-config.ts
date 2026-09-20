/**
 * VS-633: the built-in agent's providers and MCP servers live in the daemon config and may be
 * overridden per workspace. One pure function decides what a workspace sees, so the runtime host,
 * the engine, the routes and the terminal agent cannot disagree. A workspace entry with the same id
 * replaces the daemon's whole (no field-level merge); a workspace may add entries; a name listed in
 * `disabled` hides the daemon's entry from that workspace (a workspace entry of that name still wins).
 */
export type ConfigSource = 'daemon' | 'workspace' | 'override';

export interface ScopedEntry<T> { value: T; source: ConfigSource; }

export interface ScopedInput<T> {
  daemon: Record<string, T> | undefined;
  workspace: Record<string, T> | undefined;
  disabled?: readonly string[] | undefined;
}

/** What one workspace sees, in daemon-then-workspace-addition order, each entry marked with where it came from. */
export function mergeScoped<T>(input: ScopedInput<T>): Record<string, ScopedEntry<T>> {
  const out: Record<string, ScopedEntry<T>> = {};
  const workspace = input.workspace ?? {};
  const disabled = new Set(input.disabled ?? []);
  for (const [id, value] of Object.entries(input.daemon ?? {})) {
    if (id in workspace) out[id] = { value: workspace[id]!, source: 'override' };
    else if (!disabled.has(id)) out[id] = { value, source: 'daemon' };
  }
  for (const [id, value] of Object.entries(workspace)) if (!(id in out)) out[id] = { value, source: 'workspace' };
  return out;
}

/** The entries alone, for a caller that does not need the marks. */
export function mergedValues<T>(input: ScopedInput<T>): Record<string, T> {
  return Object.fromEntries(Object.entries(mergeScoped(input)).map(([id, e]) => [id, e.value]));
}

/** Daemon ids a workspace hides: listed as disabled and not replaced by an entry of its own. */
export function disabledInherited<T>(input: ScopedInput<T>): string[] {
  const workspace = input.workspace ?? {};
  return (input.disabled ?? []).filter((id) => id in (input.daemon ?? {}) && !(id in workspace));
}
