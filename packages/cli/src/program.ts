/** The `oc` command tree (PLAN §20). Exported separately from `bin.ts` so tests can parse without exiting. */
import { Command, Option } from 'commander';
import { configureOutput } from './output.js';
import * as agent from './commands/agent.js';
import * as auth from './commands/auth.js';
import * as conductor from './commands/conductor.js';
import * as conversation from './commands/conversation.js';
import * as daemon from './commands/daemon.js';
import * as decision from './commands/decision.js';
import * as doctor from './commands/doctor.js';
import * as init from './commands/init.js';
import * as knowledge from './commands/knowledge.js';
import * as presentation from './commands/presentation.js';
import * as project from './commands/project.js';
import * as role from './commands/role.js';
import * as runs from './commands/runs.js';
import * as runtime from './commands/runtime.js';
import * as specs from './commands/specs.js';
import * as ticket from './commands/ticket.js';
import * as usage from './commands/usage.js';
import * as worker from './commands/worker.js';
import * as workspace from './commands/workspace.js';
import * as worktree from './commands/worktree.js';

export const VERSION = '0.1.0';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('oc')
    .description('OpenConductor — talk to the conductor, watch the fleet, ship work')
    .version(VERSION, '-v, --version')

    .showHelpAfterError()
    .addOption(new Option('-w, --workspace <id>', 'workspace id').env('OC_WORKSPACE'))
    .option('--json', 'machine-readable output on every command', false)
    .option('--no-color', 'disable colour')
    .option('--context <name>', 'use a named context from contexts.yaml')
    .addOption(new Option('--url <url>', 'daemon url (bypasses the contexts file)').env('OC_API_URL'))
    .addOption(new Option('--token <token>', 'bearer token').env('OC_TOKEN'))
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts<{ json?: boolean; color?: boolean }>();
      configureOutput({
        json: opts.json === true,
        color: opts.color !== false && process.env['NO_COLOR'] === undefined && process.stdout.isTTY === true,
      });
    });

  for (const register of [
    init.register, daemon.register, auth.register, workspace.register, project.register, runtime.register,
    role.register, worker.register, ticket.register, decision.register, conversation.register, conductor.register,
    presentation.register, runs.register, usage.register, knowledge.register, specs.register, worktree.register,
    doctor.register, agent.register,
  ]) register(program);

  return program;
}
