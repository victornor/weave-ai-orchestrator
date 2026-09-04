#!/usr/bin/env node
import { buildProgram } from './program.js';
import { printError } from './output.js';

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  process.exitCode = printError(error);
});
