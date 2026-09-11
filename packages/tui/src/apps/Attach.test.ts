import { describe, expect, it } from 'vitest';
import { deliveryNotice, preSendLabel } from './Attach.js';

describe('deliveryNotice (VS-99)', () => {
  it('reports mid-turn delivery only when the server said so', () => {
    expect(deliveryNotice({ delivery: 'mid_turn' })).toBe('delivered to the running turn');
  });

  it('reports queued for the queued outcome', () => {
    expect(deliveryNotice({ delivery: 'queued' })).toBe('queued for the next turn');
  });

  it('never invents "delivered" for a missing or unrecognised outcome', () => {
    expect(deliveryNotice(null)).toBe('queued for the next turn');
    expect(deliveryNotice(undefined)).toBe('queued for the next turn');
    expect(deliveryNotice({})).toBe('queued for the next turn');
  });
});

describe('preSendLabel (VS-253)', () => {
  it('says the words reach the running turn when the API says so', () => {
    expect(preSendLabel({ midTurn: true })).toBe('Reaches the running turn immediately.');
  });

  it('says queued and carries the reason the API supplied', () => {
    expect(preSendLabel({ midTurn: false, reason: 'Codex does not support delivering input to a turn that is already running' }))
      .toBe('Queued for the next turn — Codex does not support delivering input to a turn that is already running.');
  });

  it('says queued without inventing a reason', () => {
    expect(preSendLabel({ midTurn: false })).toBe('Queued for the next turn.');
  });

  it('shows no label before the status is known', () => {
    expect(preSendLabel(null)).toBeNull();
    expect(preSendLabel(undefined)).toBeNull();
  });
});
