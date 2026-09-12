/** `weave decision list|show|answer` — everything waiting on a human (PLAN §15, §20). */
import type { Command } from 'commander';
import type { Decision } from '@weave-ai/shared';
import { decisionToCard, type CardModel } from '@weave-ai/render';
import { ApiError } from '../api.js';
import { emit, fields, heading, style, table, write } from '../output.js';
import { promptTyped } from '../prompt.js';
import { items, run, session, unwrap } from './util.js';

/** Shared by the CLI and the TUI: a card printed as numbered options. */
export function printCard(card: CardModel): void {
  heading(`${card.header}  ${style.dim(card.subtitle ?? '')}`);
  write(style.bold(card.title));
  if (card.rationale) write(style.dim(card.rationale));
  if (card.body.length) {
    write('');
    fields(card.body.map((line) => [line.label ?? '', line.value] as [string, string]));
  }
  if (card.options.length) {
    write('');
    card.options.forEach((option, index) => {
      const marker = option.recommended ? style.accent(' PICKED') : '';
      write(`  ${style.bold(String(index + 1))}. ${option.label}${marker}${option.tone === 'danger' ? style.bad('  destructive') : ''}`);
      if (option.consequence) write(`     ${style.dim(option.consequence)}`);
    });
  }
  if (card.allowFreeText) write(`  ${style.dim(`or free text: weave decision answer ${card.id} "<text>"`)}`);
  if (card.confirm) write(style.warn(`  ${card.confirm.prompt}`));
}

/**
 * `--override-hold <reason>` (VS-266, VS-281): a distinct, deliberate pair, meaningful only on a
 * decision the card model itself reports as held — either the concerns hold (`held`) or the
 * unreviewed hold (`awaitsReview`). Never a no-op flag that silently does nothing, and never
 * satisfiable by resubmitting the same key the hold already refused.
 */
export function resolveOverrideHold(card: Pick<CardModel, 'held' | 'awaitsReview' | 'id'>, reason: string | undefined): { overrideHold: true; overrideReason: string } | undefined {
  if (reason === undefined) return undefined;
  if (!card.held && !card.awaitsReview) throw new ApiError('validation', `${card.id} is not held (no pending weaver review or concern); --override-hold does not apply here`, 400);
  return { overrideHold: true, overrideReason: reason };
}

export function register(program: Command): void {
  const decision = program.command('decision').description('decisions waiting for an answer');

  decision
    .command('list', { isDefault: true })
    .description('list decisions')
    .option('-s, --status <statuses>', 'comma-separated; defaults to open', 'open')
    .option('--owner <owner>', 'human|weaver')
    .action(async (opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.wget('/decisions', { status: opts['status'], owner: opts['owner'] });
      const rows = items<Decision>(payload, 'decisions').map((d) => decisionToCard(d, {}));
      emit(payload, () => {
        table(rows, [
          { header: '', get: (r) => (r.destructive ? style.bad('!') : r.status === 'open' ? '◆' : ' ') },
          { header: 'ID', get: (r) => r.id },
          { header: 'KIND', get: (r) => r.kind },
          { header: 'TITLE', get: (r) => r.title },
          { header: 'TICKET', get: (r) => r.subtitle ?? '' },
          { header: 'OPTIONS', get: (r) => r.options.map((o) => o.key).join('|') },
          { header: 'AGE', get: (r) => r.age, align: 'right' },
        ], { empty: 'nothing needs you right now' });
      });
    }));

  decision
    .command('show')
    .argument('<id>')
    .description('show one decision as a card')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const d = await client.wget<unknown>(`/decisions/${encodeURIComponent(id)}`);
      const card = decisionToCard(unwrap<Decision>(d, 'decision'), {});
      emit(d, () => printCard(card));
    }));

  decision
    .command('answer')
    .argument('<id>')
    .argument('[answer]', 'option key, option number, or free text')
    .option('--text <text>', 'free-text answer (with or without a key)')
    .option('--remember', 'remember this answer for similar decisions')
    .option('--yes', 'skip the typed confirmation on destructive decisions')
    .option('--override-hold <reason>', 'deliberately approve a decision the weaver has concerns about, stating why (VS-266)')
    .description('answer a decision')
    .action(async (id: string, answer: string | undefined, opts: Record<string, string | boolean>, command: Command) => run(async () => {
      const { client } = await session(command);
      const raw = await client.wget<unknown>(`/decisions/${encodeURIComponent(id)}`);
      const card = decisionToCard(unwrap<Decision>(raw, 'decision'), {});

      let key: string | undefined;
      let text: string | undefined = typeof opts['text'] === 'string' ? opts['text'] : undefined;

      if (answer) {
        const byNumber = Number.parseInt(answer, 10);
        if (Number.isFinite(byNumber) && byNumber >= 1 && byNumber <= card.options.length) key = card.options[byNumber - 1]!.key;
        else if (card.options.some((o) => o.key === answer)) key = answer;
        else if (card.allowFreeText) text = text ?? answer;
        else throw new ApiError('validation', `not an option of ${id}: ${answer}`, 400, { options: card.options.map((o) => o.key) });
      }
      if (!key && !text) throw new ApiError('validation', 'pass an option key, an option number, or free text', 400, { options: card.options.map((o) => o.key) });

      const override = resolveOverrideHold(card, typeof opts['overrideHold'] === 'string' ? opts['overrideHold'] : undefined);

      const chosen = card.options.find((o) => o.key === key);
      if (card.confirm && chosen?.tone === 'danger' && opts['yes'] !== true) {
        const confirmed = await promptTyped(card.confirm.expect, card.confirm.prompt);
        if (!confirmed) {
          emit({ answered: false, reason: 'not confirmed' }, () => write(style.dim('not confirmed — the decision is still open')));
          return;
        }
      }

      const body: Record<string, unknown> = {};
      if (key) body['key'] = key;
      if (text) body['text'] = text;
      if (opts['remember'] === true) body['remember'] = true;
      if (override) Object.assign(body, override);

      const result = await client.write({
        tool: 'weave_decision_answer', input: { decisionId: id, ...body },
        http: { method: 'POST', path: client.w(`/decisions/${encodeURIComponent(id)}/answer`), body },
      });
      emit(result, () => write(`${style.ok('answered')} ${id}${key ? ` -> ${key}` : ''}`));
    }));

  decision
    .command('withdraw')
    .argument('<id>')
    .option('--reason <reason>', 'why', 'withdrawn from the CLI')
    .description('withdraw a decision')
    .action(async (id: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.wpost(`/decisions/${encodeURIComponent(id)}/withdraw`, { reason: opts['reason'] ?? '' });
      emit(result, () => write(`${style.ok('withdrawn')} ${id}`));
    }));
}
