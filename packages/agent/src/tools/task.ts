/**
 * `task` (S9): hand a bounded, read-only investigation to an explore subagent. The subagent is a
 * nested loop inside the same child (see `runExplore` in `loop.ts`): a fresh history, only
 * `read`, `grep` and `glob`, no `task` of its own (depth 1), a step cap, and the parent's abort
 * signal. Only its final text comes back, as this tool's result, so the parent's context does not
 * carry the subagent's reading. The tool itself only validates the arguments and delegates.
 */
import { errorOutput, type ToolCtx, type ToolDefinition, type ToolOutput } from './index.js';

export const EXPLORE_AGENT = 'explore';
/** Model requests one explore subagent may make before it must answer with what it has. */
export const EXPLORE_MAX_STEPS = 20;

export const EXPLORE_SYSTEM = [
  'You are an explore subagent working for another coding agent, inside a git worktree.',
  'You can only look: `read` files and directories, `grep` for text and `glob` for file names. You cannot change anything or run commands.',
  'Answer the task you were given. Search efficiently, read what matters, and finish with a compact report: what you found, with file paths and line numbers, and anything you could not determine.',
  'Your last message is returned to the other agent as the whole result, so put everything it needs in it.',
].join('\n');

export interface ExploreRequest { description: string; prompt: string }
/** Runs the subagent to completion; supplied by the loop, which owns the provider and the events. */
export type ExploreRunner = (req: ExploreRequest, ctx: ToolCtx) => Promise<ToolOutput>;

export function makeTaskTool(run: ExploreRunner): ToolDefinition {
  return {
    name: 'task',
    description: 'Delegate a read-only investigation to an explore subagent and get back its written findings. Use it to search or read widely without filling your own context. It cannot edit files or run commands, and it cannot start further subagents. Give it a self-contained prompt: it has none of this conversation.',
    // Read-only: the subagent's tools are, so `restricted` keeps it.
    readOnly: true,
    parameters: {
      type: 'object', additionalProperties: false, required: ['description', 'prompt'],
      properties: {
        description: { type: 'string', description: 'three to five words naming the task' },
        prompt: { type: 'string', description: 'what to find out, with every detail the subagent needs' },
        agent: { type: 'string', enum: [EXPLORE_AGENT], default: EXPLORE_AGENT },
      },
    },
    async run(args, ctx) {
      if (typeof args['prompt'] !== 'string' || !args['prompt'].trim()) return errorOutput('prompt is required');
      if (args['agent'] !== undefined && args['agent'] !== EXPLORE_AGENT) return errorOutput(`unknown agent "${String(args['agent'])}"; only "${EXPLORE_AGENT}" is available`);
      const description = typeof args['description'] === 'string' && args['description'].trim() ? args['description'].trim() : 'explore';
      return run({ description, prompt: args['prompt'] }, ctx);
    },
  };
}
