/**
 * `workerActivity` — the one-line "what is this worker doing right now" summary derived from a run
 * event (VS-328). A closed set of human verbs keyed off the normalized event shape every runtime
 * adapter emits, never off runtime-specific prose.
 *
 * Returns null for an event that says nothing about the current activity (assistant text, thinking,
 * usage, lifecycle); callers keep the previous line rather than flapping on every token.
 */
import type { RunEvent } from '@weave-ai/shared';
import { oneLine } from './format.js';
import { toolTarget } from './transcript.js';

export type WorkerActivityVerb = 'editing' | 'writing' | 'reading' | 'testing' | 'command' | 'researching' | 'working';

export interface WorkerActivityLine {
  verb: WorkerActivityVerb;
  /** The full human label, including the target: `Editing src/Board.tsx`, `Reading code`. */
  label: string;
  /** The path/command/url the activity is about, when there is one. */
  target: string | null;
}

type Payload = Record<string, unknown>;

const str = (p: Payload | null | undefined, ...keys: string[]): string | null => {
  if (!p) return null;
  for (const k of keys) if (typeof p[k] === 'string' && (p[k] as string).length > 0) return p[k] as string;
  return null;
};
const obj = (p: Payload | null | undefined, ...keys: string[]): Payload | null => {
  if (!p) return null;
  for (const k of keys) {
    const v = p[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Payload;
  }
  return null;
};

/** Edit vs write by tool name; both render as `Editing`/`Writing <file>`. */
const WRITE_TOOLS = new Set(['write', 'writefile', 'write_file', 'create_file', 'createfile', 'str_replace_editor']);
const EDIT_TOOLS = new Set(['edit', 'multiedit', 'multi_edit', 'patch', 'replace', 'str_replace', 'apply_patch', 'notebookedit', 'notebook_edit', 'editfile', 'edit_file']);
const READ_TOOLS = new Set(['read', 'readfile', 'read_file', 'view', 'cat', 'grep', 'glob', 'search', 'list', 'ls', 'listdir', 'list_dir', 'codebase_search', 'file_search']);
const SHELL_TOOLS = new Set(['bash', 'shell', 'run_shell_command', 'powershell', 'terminal', 'execute', 'exec', 'command', 'run']);
const WEB_TOOLS = new Set(['webfetch', 'web_fetch', 'websearch', 'web_search', 'fetch']);

/** A command that runs a test suite, by runner or by a package manager's test script. */
export function isTestCommand(command: string | null | undefined): boolean {
  if (typeof command !== 'string' || command.length === 0) return false;
  return /\b(vitest|jest|pytest|py\.test|ava|mocha|jasmine|rspec|phpunit)\b/i.test(command)
    || /\bgo\s+test\b/i.test(command)
    || /\bcargo\s+test\b/i.test(command)
    || /\bdotnet\s+test\b/i.test(command)
    || /\bnode\s+--test\b/i.test(command)
    || /\bbun\s+test\b/i.test(command)
    || /\b(npm|pnpm|yarn|bun)\b[^\n]*\btest\b/i.test(command);
}

function line(verb: WorkerActivityVerb, target: string | null): WorkerActivityLine {
  const labels: Record<WorkerActivityVerb, string> = {
    editing: 'Editing', writing: 'Writing', reading: 'Reading code', testing: 'Running tests',
    command: 'Running a command', researching: 'Researching', working: 'Working',
  };
  return { verb, label: target ? `${labels[verb]} ${target}` : labels[verb], target };
}

/** Map one tool name + input to an activity line, or null when the name is not a tool we know. */
function fromToolName(name: string, input: Payload | null): WorkerActivityLine | null {
  const n = name.toLowerCase();
  const target = toolTarget(name, input);
  if (WRITE_TOOLS.has(n)) return line('writing', target);
  if (EDIT_TOOLS.has(n)) return line('editing', target);
  if (READ_TOOLS.has(n)) return line('reading', null);
  if (WEB_TOOLS.has(n)) return line('researching', null);
  if (SHELL_TOOLS.has(n)) {
    const command = str(input, 'command', 'cmd', 'script');
    return line(isTestCommand(command) ? 'testing' : 'command', null);
  }
  return null;
}

/**
 * The activity a single event describes, or null when it describes none. `run.phase.timing` is
 * deliberately not read here: a phase marker says bookkeeping finished, not what is being done now.
 */
export function workerActivity(event: RunEvent | null | undefined): WorkerActivityLine | null {
  if (!event) return null;
  const p = (event.payload ?? {}) as Payload;
  switch (event.type) {
    case 'tool.call': {
      const name = str(p, 'name', 'tool') ?? 'unknown';
      const mapped = fromToolName(name, obj(p, 'input', 'arguments') ?? p);
      return mapped ?? line('working', null);
    }
    case 'command.executed': {
      // Some runtimes (Claude, Gemini, Cursor) carry no command on this event, having already been
      // read from the matching `tool.call`; without one there is nothing new to say, so keep the
      // line rather than downgrading a just-finished test run to "Running a command" (VS-328).
      const command = str(p, 'command', 'cmd');
      if (!command) return null;
      return line(isTestCommand(command) ? 'testing' : 'command', null);
    }
    case 'file.changed':
      return line('editing', str(p, 'path') ? oneLine(str(p, 'path')!, 80) : null);
    case 'runtime.raw': {
      // Codex reports a web search as an opaque item rather than a tool call (VS-328).
      const original = str(p, 'originalType') ?? '';
      return /web_search|websearch/i.test(original) ? line('researching', null) : null;
    }
    default:
      return null;
  }
}
