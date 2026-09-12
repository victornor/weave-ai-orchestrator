/** The `conductor` command tree (PLAN §20). Exported separately from `bin.ts` so tests can parse without exiting. */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, Option } from 'commander';
import { releaseVersion } from '@weave-ai/release';
import { configureOutput } from './output.js';
import * as agent from './commands/agent.js';
import * as auth from './commands/auth.js';
import * as changelog from './commands/changelog.js';
import * as weaver from './commands/weaver.js';
import * as conversation from './commands/conversation.js';
import * as daemon from './commands/daemon.js';
import * as decision from './commands/decision.js';
import * as doctor from './commands/doctor.js';
import * as init from './commands/init.js';
import * as knowledge from './commands/knowledge.js';
import * as models from './commands/models.js';
import * as presentation from './commands/presentation.js';
import * as project from './commands/project.js';
import * as role from './commands/role.js';
import * as routine from './commands/routine.js';
import * as runs from './commands/runs.js';
import * as runtime from './commands/runtime.js';
import * as specs from './commands/specs.js';
import * as ticket from './commands/ticket.js';
import * as usage from './commands/usage.js';
import * as worker from './commands/worker.js';
import * as workspace from './commands/workspace.js';
import * as worktree from './commands/worktree.js';

const here = dirname(fileURLToPath(import.meta.url));
export const VERSION = releaseVersion(resolve(here, '..', '..', '..'));

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('weave')
    .description('Weave AI — talk to the weaver, watch the fleet, ship work')
    .version(VERSION, '-v, --version')

    .showHelpAfterError()
    .addOption(new Option('-w, --workspace <id>', 'workspace id').env('AC_WORKSPACE'))
    .option('--json', 'machine-readable output on every command', false)
    .option('--no-color', 'disable colour')
    .option('--context <name>', 'use a named context from contexts.yaml')
    .addOption(new Option('--url <url>', 'daemon url (bypasses the contexts file)').env('AC_API_URL'))
    .addOption(new Option('--token <token>', 'bearer token').env('AC_TOKEN'))
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts<{ json?: boolean; color?: boolean }>();
      configureOutput({
        json: opts.json === true,
        color: opts.color !== false && process.env['NO_COLOR'] === undefined && process.stdout.isTTY === true,
      });
    });

  for (const register of [
    init.register, daemon.register, auth.register, workspace.register, project.register, runtime.register,
    models.register, role.register, worker.register, ticket.register, decision.register, conversation.register, weaver.register,
    presentation.register, runs.register, usage.register, knowledge.register, changelog.register, specs.register, worktree.register,
    doctor.register, agent.register, routine.register,
  ]) register(program);

  return program;
}
