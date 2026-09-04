/** Small interactive prompts. Hidden input is hand-rolled so `conductor` needs no prompt dependency. */
import { createInterface, type Interface } from 'node:readline';
import { Writable } from 'node:stream';

function assertInteractive(): void {
  if (!process.stdin.isTTY) throw new Error('this command needs an interactive terminal (or pass the value as a flag)');
}

export async function promptLine(question: string, options: { default?: string } = {}): Promise<string> {
  assertInteractive();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = options.default ? ` [${options.default}]` : '';
    const answer = await new Promise<string>((resolve) => rl.question(`${question}${suffix}: `, resolve));
    const trimmed = answer.trim();
    return trimmed === '' ? options.default ?? '' : trimmed;
  } finally {
    rl.close();
  }
}

/** Password / TOTP entry: echoes nothing, and always leaves the terminal in a sane state. */
export async function promptHidden(question: string): Promise<string> {
  assertInteractive();
  let muted = false;
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl: Interface = createInterface({ input: process.stdin, output: sink, terminal: true });
  try {
    return await new Promise<string>((resolve, reject) => {
      rl.question(`${question}: `, (value) => resolve(value));
      rl.once('SIGINT', () => reject(new Error('cancelled')));
      muted = true;
    });
  } finally {
    muted = false;
    rl.close();
    process.stdout.write('\n');
  }
}

export async function promptConfirm(question: string, defaultYes = false): Promise<boolean> {
  const answer = await promptLine(`${question} ${defaultYes ? '[Y/n]' : '[y/N]'}`, { default: defaultYes ? 'y' : 'n' });
  return /^y(es)?$/i.test(answer.trim());
}

/** Destructive confirmation: the human must type the exact string (design contract §4). */
export async function promptTyped(expect: string, question = `Type ${expect} to confirm`): Promise<boolean> {
  const answer = await promptLine(question);
  return answer.trim() === expect;
}
