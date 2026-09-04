#!/usr/bin/env node
import { buildProgram } from './program.js';
import { printError } from './output.js';

// `oc … | head` closes the pipe early; that is not an error worth a stack trace.
process.stdout.on('error', (err: NodeJS.ErrnoException) => { if (err.code === 'EPIPE') process.exit(0); throw err; });

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  process.exitCode = printError(error);
});
