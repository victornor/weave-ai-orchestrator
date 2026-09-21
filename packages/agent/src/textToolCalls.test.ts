import { describe, expect, it } from 'vitest';
import { detectTextToolCalls } from './textToolCalls.js';

describe('detectTextToolCalls', () => {
  it('recognises the doubled full-width DSML form seen in VS-639', () => {
    expect(detectTextToolCalls('Let me look.\n<｜｜DSML｜｜ invoke name="bash">\n<｜｜DSML｜｜ parameter name="command" string="true">ls</｜｜DSML｜｜ parameter>')).toBe('dsml');
  });
  it('recognises the single-bar and ASCII forms', () => {
    expect(detectTextToolCalls('<｜DSML｜invoke name="read">')).toBe('dsml');
    expect(detectTextToolCalls('<|DSML|invoke name="read">')).toBe('dsml');
  });
  it('ignores prose and a bare marker without invoke', () => {
    expect(detectTextToolCalls('I would call the bash tool with invoke semantics.')).toBeNull();
    expect(detectTextToolCalls('The DSML format is documented here.')).toBeNull();
    expect(detectTextToolCalls('<｜DSML｜parameter name="x">')).toBeNull();
  });
});
