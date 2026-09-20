import { describe, expect, it } from 'vitest';
import { invalidToolMessage, repairArgs } from './repair.js';

const CLOSE = { closeTorn: true };
describe('repairArgs', () => {
  it('passes valid JSON through untouched, and treats empty as {}', () => {
    expect(repairArgs('{"a":1}')).toEqual({ ok: true, value: { a: 1 }, repaired: false });
    expect(repairArgs('')).toEqual({ ok: true, value: {}, repaired: false });
  });
  it('strips a Markdown fence and trailing commas', () => {
    expect(repairArgs('```json\n{"a":1,}\n```')).toEqual({ ok: true, value: { a: 1 }, repaired: true });
  });
  it('unwraps an object that was JSON-encoded as a string', () => {
    expect(repairArgs('"{\\"a\\":1}"')).toEqual({ ok: true, value: { a: 1 }, repaired: true });
  });
  it('closes the brackets a torn stream left open', () => {
    expect(repairArgs('{"path":"a.txt"', CLOSE)).toEqual({ ok: true, value: { path: 'a.txt' }, repaired: true });
    expect(repairArgs('{"a":{"b":[1,2', CLOSE)).toEqual({ ok: true, value: { a: { b: [1, 2] } }, repaired: true });
    expect(repairArgs('{"a":1,', CLOSE)).toEqual({ ok: true, value: { a: 1 }, repaired: true });
  });
  it('drops a key cut off before its value instead of inventing one', () => {
    expect(repairArgs('{"path":"a.txt","content":', CLOSE)).toEqual({ ok: true, value: { path: 'a.txt' }, repaired: true });
  });
  it('does not close a string cut off mid-value: that is truncated data', () => {
    expect(repairArgs('{"path":"/home/a/b', CLOSE).ok).toBe(false);
    expect(repairArgs('{"content":"half a fi', CLOSE).ok).toBe(false);
  });
  it('does not close anything unless asked (a reply cut off by the output limit)', () => {
    expect(repairArgs('{"path":"a.txt"').ok).toBe(false);
  });
  it('rejects what is not an object, and garbage', () => {
    expect(repairArgs('[1,2]')).toMatchObject({ ok: false, error: 'arguments must be a JSON object' });
    expect(repairArgs('{"a": nope}').ok).toBe(false);
  });
  it('words the corrective result for the model', () => {
    expect(invalidToolMessage('read', 'Unexpected token')).toBe('the arguments for read are not valid JSON (Unexpected token). Send exactly one JSON object with the documented keys');
  });
});
