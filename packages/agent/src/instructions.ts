import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Message } from './types.js';

/** A nested instruction file is cut to this many bytes. */
export const INSTRUCTION_MAX_BYTES = 32 * 1024;
const MARKER = /^\[instructions from (.+)\]$/gm;

/**
 * Lazy nested `AGENTS.md` loading (OpenCode's approach): when a file tool first touches a directory, the
 * nearest instruction files between it and the worktree root that this conversation does not hold yet are
 * appended once to that tool's result. Each file is loaded once per conversation; after a compaction the ones
 * that fell out of the kept history are loaded again the next time their directory is touched.
 */
export class InstructionLoader {
  private loaded = new Set<string>();
  constructor(private readonly root: string, private readonly file = 'AGENTS.md') {}

  private pinned = new Set<string>();
  /** Mark a file as already in the prompt (the home's own AGENTS.md is in the system prompt): never loaded again. */
  pin(path: string): void { const p = resolve(path); this.pinned.add(p); this.loaded.add(p); }

  /** Rebuild the loaded set from the messages the model can still see, plus the pinned files. */
  syncFrom(messages: readonly Message[]): void {
    this.loaded = new Set(this.pinned);
    for (const m of messages) {
      if (m.role !== 'toolResult') continue;
      for (const hit of m.text.matchAll(MARKER)) this.loaded.add(resolve(hit[1]!));
    }
  }

  /** The text to append to the result of a tool that touched `path`, or '' when there is nothing new. */
  forPath(path: string): string {
    const abs = resolve(path);
    const rel = relative(this.root, abs);
    if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(rel) === rel) return '';
    let dir = dirname(abs);
    const found: string[] = [];
    for (;;) {
      const candidate = join(dir, this.file);
      if (!this.loaded.has(candidate) && existsSync(candidate) && isFile(candidate)) found.push(candidate);
      if (dir === this.root) break;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    let out = '';
    // The root file first, the nearest last: the more specific instruction reads last.
    for (const p of found.reverse()) {
      this.loaded.add(p);
      let text = readFileSync(p, 'utf8');
      if (Buffer.byteLength(text) > INSTRUCTION_MAX_BYTES) text = `${Buffer.from(text).subarray(0, INSTRUCTION_MAX_BYTES).toString('utf8')}\n[truncated at ${INSTRUCTION_MAX_BYTES} bytes]`;
      out += `\n\n[instructions from ${p}]\n${text.trimEnd()}`;
    }
    return out;
  }
}
const isFile = (p: string): boolean => { try { return statSync(p).isFile(); } catch { return false; } };
