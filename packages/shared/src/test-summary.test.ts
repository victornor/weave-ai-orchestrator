import { describe, expect, it } from 'vitest';
import { parseTestSummary } from './test-summary.js';

describe('parseTestSummary (VS-328)', () => {
  it('reads vitest passing output', () => {
    const out = [' Test Files  24 passed (24)', '      Tests  231 passed (231)', '   Duration  4.12s'].join('\n');
    expect(parseTestSummary(out)).toEqual({ passed: 231, total: 231 });
  });

  it('reads vitest failing output', () => {
    const out = [' Test Files  2 failed | 22 passed (24)', '      Tests  3 failed | 228 passed (231)', '     Errors  1 error'].join('\n');
    expect(parseTestSummary(out)).toEqual({ passed: 228, total: 231 });
  });

  it('excludes vitest skipped tests from the total', () => {
    // This repository's own suite shape: a clean run with one skipped file must read all-green.
    expect(parseTestSummary('      Tests  2897 passed | 1 skipped (2898)')).toEqual({ passed: 2897, total: 2897 });
  });

  it('excludes vitest todo tests from the total', () => {
    expect(parseTestSummary('      Tests  10 passed | 2 todo (12)')).toEqual({ passed: 10, total: 10 });
  });

  it('sums every vitest suite in one output', () => {
    const out = [
      '      Tests  2897 passed | 1 skipped (2898)',
      '      Tests  1677 passed (1677)',
    ].join('\n');
    expect(parseTestSummary(out)).toEqual({ passed: 4574, total: 4574 });
  });

  it('sums vitest suites when one is failing', () => {
    const out = [
      '      Tests  2897 passed | 1 skipped (2898)',
      '      Tests  2 failed | 1675 passed (1677)',
    ].join('\n');
    expect(parseTestSummary(out)).toEqual({ passed: 4572, total: 4574 });
  });

  it('reads jest passing output', () => {
    const out = ['Test Suites: 3 passed, 3 total', 'Tests:       28 passed, 28 total', 'Snapshots:   0 total', 'Time:        3.421 s'].join('\n');
    expect(parseTestSummary(out)).toEqual({ passed: 28, total: 28 });
  });

  it('reads jest failing output', () => {
    const out = ['Tests:       2 failed, 26 passed, 28 total', 'Test Suites: 1 failed, 2 passed, 3 total'].join('\n');
    expect(parseTestSummary(out)).toEqual({ passed: 26, total: 28 });
  });

  it('excludes jest skipped tests from the total', () => {
    expect(parseTestSummary('Tests:       1 skipped, 2897 passed, 2898 total')).toEqual({ passed: 2897, total: 2897 });
  });

  it('reads bun test output', () => {
    const out = [' 28 pass', ' 2 fail', ' 30 expect() calls', 'Ran 30 tests across 3 files. [123.00ms]'].join('\n');
    expect(parseTestSummary(out)).toEqual({ passed: 28, total: 30 });
  });

  it('reads node --test output', () => {
    const out = ['# tests 30', '# suites 4', '# pass 28', '# fail 2', '# cancelled 0', '# skipped 0'].join('\n');
    expect(parseTestSummary(out)).toEqual({ passed: 28, total: 30 });
  });

  it('excludes node --test skipped tests from the total', () => {
    const out = ['# tests 30', '# pass 28', '# fail 1', '# skipped 1'].join('\n');
    expect(parseTestSummary(out)).toEqual({ passed: 28, total: 29 });
  });

  it('reads pytest passing output', () => {
    expect(parseTestSummary('===== 28 passed, 1 warning in 1.23s =====')).toEqual({ passed: 28, total: 28 });
  });

  it('reads pytest failing output', () => {
    expect(parseTestSummary('===== 2 failed, 26 passed, 1 skipped in 1.23s =====')).toEqual({ passed: 26, total: 28 });
  });

  it('reads cargo test output across binaries', () => {
    const out = [
      'running 20 tests',
      'test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s',
      'running 8 tests',
      'test result: FAILED. 6 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s',
    ].join('\n');
    expect(parseTestSummary(out)).toEqual({ passed: 26, total: 28 });
  });

  it('reads dotnet test output', () => {
    const out = ['Passed!  - Failed:     2, Passed:    26, Skipped:     0, Total:    28, Duration: 1 s'].join('\n');
    expect(parseTestSummary(out)).toEqual({ passed: 26, total: 28 });
  });

  it('excludes dotnet skipped tests from the total', () => {
    expect(parseTestSummary('Passed!  - Failed:     0, Passed:    28, Skipped:     2, Total:    30, Duration: 1 s')).toEqual({ passed: 28, total: 28 });
  });

  it('reads go test verbose output', () => {
    const out = ['=== RUN   TestOne', '--- PASS: TestOne (0.00s)', '--- FAIL: TestTwo (0.00s)', 'FAIL', 'exit status 1'].join('\n');
    expect(parseTestSummary(out)).toEqual({ passed: 1, total: 2 });
  });

  it('returns null for go test package output, because a package is not a test', () => {
    const out = ['ok  \texample.com/a\t0.012s', 'ok  \texample.com/b\t0.010s', 'FAIL\texample.com/c\t0.011s'].join('\n');
    expect(parseTestSummary(out)).toBeNull();
  });

  it('returns null for output with no summary', () => {
    expect(parseTestSummary('hello world\nno tests here')).toBeNull();
  });

  it('returns null for a line that merely contains the word passed', () => {
    expect(parseTestSummary('the tests passed but no count is shown')).toBeNull();
  });

  it('returns null for empty, null and undefined input', () => {
    expect(parseTestSummary('')).toBeNull();
    expect(parseTestSummary(null)).toBeNull();
    expect(parseTestSummary(undefined)).toBeNull();
  });
});
