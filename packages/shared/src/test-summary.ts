/**
 * Parse a passed/total test tally from a runner's summary output (VS-328).
 *
 * One function for the common runners, deliberately conservative: every parser reads the runner's
 * own summary line, and anything unrecognised yields `null` rather than a guessed number. Callers
 * must show nothing when this returns null.
 *
 * `total` is the tests that ran — passed plus failed. Skipped, todo and ignored tests are excluded,
 * so a suite with nothing failing reads as a clean run. An output carrying more than one suite (a
 * script that runs core then UI, say) is summed across every summary line, like cargo and dotnet.
 *
 * Supported: vitest, jest, bun test, `node --test`, pytest, `go test`, cargo test, `dotnet test`.
 */

export interface TestTally {
  /** Tests that passed. */
  passed: number;
  /** Tests that ran: passed plus failed. Excludes skipped/todo/ignored. */
  total: number;
}

/** A sane tally from passed and failed counts: at least one test ran, none negative. */
function tally(passed: number, failed: number): TestTally | null {
  const total = passed + failed;
  if (!Number.isFinite(passed) || !Number.isFinite(failed)) return null;
  if (total <= 0 || passed < 0 || failed < 0) return null;
  return { passed, total };
}

const countOf = (text: string, word: string): number => Number(text.match(new RegExp(`(\\d+)\\s+${word}\\b`))?.[1] ?? '0');

/** vitest: `Tests  231 passed (231)`, `Tests  3 failed | 228 passed (231)`, `Tests  2897 passed | 1 skipped (2898)`. */
function vitest(output: string): TestTally | null {
  let passed = 0;
  let failed = 0;
  let seen = false;
  for (const m of output.matchAll(/^[ \t]*Tests\s+([^\n]*?)\(\d+\)\s*$/gm)) {
    seen = true;
    const rest = m[1] ?? '';
    passed += countOf(rest, 'passed');
    failed += countOf(rest, 'failed');
  }
  return seen ? tally(passed, failed) : null;
}

/** jest: `Tests:       2 failed, 26 passed, 28 total`; skipped tests are in `total` but not "ran". */
function jest(output: string): TestTally | null {
  let passed = 0;
  let failed = 0;
  let seen = false;
  for (const m of output.matchAll(/^[ \t]*Tests:\s+([^\n]*?\b\d+\s+total)\s*$/gm)) {
    seen = true;
    const rest = m[1] ?? '';
    passed += countOf(rest, 'passed');
    failed += countOf(rest, 'failed');
  }
  return seen ? tally(passed, failed) : null;
}

/** bun test: ` 28 pass` / ` 2 fail`; `Ran 30 tests` counts skips, so it is not used for total. */
function bun(output: string): TestTally | null {
  const passMatch = output.match(/(\d+)\s+pass\b/);
  if (!passMatch) return null;
  return tally(Number(passMatch[1]), countOf(output, 'fail'));
}

/** node --test: `# pass 28` / `# fail 1`; `# tests` and `# skipped` are not "ran". */
function nodeTest(output: string): TestTally | null {
  const passed = output.match(/^#\s*pass\s+(\d+)\s*$/m)?.[1];
  if (passed === undefined) return null;
  const failed = output.match(/^#\s*fail\s+(\d+)\s*$/m)?.[1] ?? '0';
  return tally(Number(passed), Number(failed));
}

/** pytest: `===== 2 failed, 26 passed, 1 skipped in 1.23s =====` (counts in any order). */
function pytest(output: string): TestTally | null {
  const summary = output.match(/=+\s+([^=\n]*\b\d+\s+(?:passed|failed|error|errors)[^=\n]*?)\s+in\s+[\d.]+s\s+=+/g);
  if (!summary) return null;
  const last = summary[summary.length - 1] ?? '';
  const passed = countOf(last, 'passed');
  const failed = countOf(last, 'failed') + countOf(last, 'error') + countOf(last, 'errors');
  return tally(passed, failed);
}

/**
 * go test: count `--- PASS:` / `--- FAIL:` per test, which `-v` prints. Without `-v` the output only
 * names packages, and a package is not a test — return null rather than label packages as tests.
 */
function goTest(output: string): TestTally | null {
  const pass = (output.match(/^[ \t]*--- PASS:/gm) ?? []).length;
  const fail = (output.match(/^[ \t]*--- FAIL:/gm) ?? []).length;
  return pass + fail > 0 ? tally(pass, fail) : null;
}

/** cargo test: sum every `test result: ... N passed; M failed; ...` line across test binaries. */
function cargo(output: string): TestTally | null {
  let passed = 0;
  let failed = 0;
  let seen = false;
  for (const m of output.matchAll(/test result:\s*\w+\.\s+(\d+)\s+passed;\s+(\d+)\s+failed/g)) {
    seen = true;
    passed += Number(m[1]);
    failed += Number(m[2]);
  }
  return seen ? tally(passed, failed) : null;
}

/** dotnet test: sum `Failed: 0, Passed: 28, Skipped: 2, Total: 30` over projects; `Total` includes skips. */
function dotnet(output: string): TestTally | null {
  let passed = 0;
  let failed = 0;
  let seen = false;
  for (const m of output.matchAll(/Failed:\s*(\d+),\s*Passed:\s*(\d+)(?:,\s*Skipped:\s*\d+)?,\s*Total:\s*\d+/g)) {
    seen = true;
    failed += Number(m[1]);
    passed += Number(m[2]);
  }
  return seen ? tally(passed, failed) : null;
}

/**
 * The tally from a runner's output, or null when none can be read. Order matters only in that a
 * runner's own marker is required; a line that merely contains the word "passed" is never enough.
 */
export function parseTestSummary(output: string | null | undefined): TestTally | null {
  if (typeof output !== 'string' || output.length === 0) return null;
  return vitest(output) ?? jest(output) ?? bun(output) ?? nodeTest(output) ?? pytest(output) ?? cargo(output) ?? dotnet(output) ?? goTest(output);
}
