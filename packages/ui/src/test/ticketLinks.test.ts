/** VS-623: the one identifier linkifier — prose becomes a tag, code stays literal. */
import { describe, expect, it } from 'vitest';
import { linkTicketIdentifiers, ticketIdentifiersIn } from '../lib/ticketLinks';

describe('linkTicketIdentifiers', () => {
  it('rewrites an identifier in prose', () => {
    expect(linkTicketIdentifiers('I filed VS-623 just now.')).toBe('I filed [VS-623](#ticket:VS-623) just now.');
  });

  it('rewrites every identifier on a line', () => {
    expect(linkTicketIdentifiers('VS-1 and ACME-42')).toBe('[VS-1](#ticket:VS-1) and [ACME-42](#ticket:ACME-42)');
  });

  it('leaves an identifier inside an inline code span literal', () => {
    expect(linkTicketIdentifiers('see `VS-623` here')).toBe('see `VS-623` here');
  });

  it('leaves an identifier inside a fenced code block literal', () => {
    const source = ['before VS-1', '```', 'ticket VS-623', '```', 'after VS-2'].join('\n');
    expect(linkTicketIdentifiers(source)).toBe(
      ['before [VS-1](#ticket:VS-1)', '```', 'ticket VS-623', '```', 'after [VS-2](#ticket:VS-2)'].join('\n'),
    );
  });

  it('links prose around a code span and leaves the code span alone', () => {
    expect(linkTicketIdentifiers('VS-1 then `VS-2` then VS-3')).toBe(
      '[VS-1](#ticket:VS-1) then `VS-2` then [VS-3](#ticket:VS-3)',
    );
  });

  it('leaves a line with no identifier unchanged', () => {
    expect(linkTicketIdentifiers('just prose and `code`')).toBe('just prose and `code`');
  });
});

describe('ticketIdentifiersIn (VS-634)', () => {
  it('reads identifiers from prose in order, keeping duplicates', () => {
    expect(ticketIdentifiersIn('I moved VS-633 and re-queued VS-621, then VS-633 again.')).toEqual([
      'VS-633',
      'VS-621',
      'VS-633',
    ]);
  });

  it('leaves an identifier inside an inline code span out', () => {
    expect(ticketIdentifiersIn('see VS-1 but `VS-2` is literal')).toEqual(['VS-1']);
  });

  it('leaves an identifier inside a fenced code block out', () => {
    const source = ['before VS-1', '```', 'ticket VS-623', '```', 'after VS-2'].join('\n');
    expect(ticketIdentifiersIn(source)).toEqual(['VS-1', 'VS-2']);
  });

  it('reads prose on a line that mixes a code span', () => {
    expect(ticketIdentifiersIn('VS-1 then `VS-2` then VS-3')).toEqual(['VS-1', 'VS-3']);
  });

  it('returns nothing for prose with no identifier', () => {
    expect(ticketIdentifiersIn('just prose and `code`')).toEqual([]);
  });
});
