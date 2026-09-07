import { describe, expect, it } from 'vitest';
import { deliveryNotice } from './Attach.js';

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
