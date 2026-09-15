import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requestedRunnerLabels, runnerGaps } from './runners.js';

let dir: string;

const workflow = (name: string, body: string): void => {
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(dir, '.github', 'workflows', name), body);
};

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ac-runners-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('requestedRunnerLabels (VS-467)', () => {
  it('reads a self-hosted label and ignores GitHub-hosted images', () => {
    workflow('ci.yml', 'jobs:\n  a:\n    runs-on: ubuntu-latest\n  b:\n    runs-on: weave-ci\n');
    expect(requestedRunnerLabels(dir)).toEqual(['weave-ci']);
  });

  it('reads an array form and drops the generic labels GitHub assigns itself', () => {
    workflow('ci.yml', 'jobs:\n  a:\n    runs-on: [self-hosted, linux, x64, weave-ci]\n');
    expect(requestedRunnerLabels(dir)).toEqual(['weave-ci']);
  });

  it('ignores an unresolved expression and a multi-line scalar', () => {
    workflow('ci.yml', 'jobs:\n  a:\n    runs-on: ${{ inputs.runner }}\n  b:\n    runs-on: |\n      weave-ci\n');
    expect(requestedRunnerLabels(dir)).toEqual([]);
  });

  it('reads every workflow file and an absent directory is empty', () => {
    expect(requestedRunnerLabels(dir)).toEqual([]);
    workflow('ci.yml', 'jobs:\n  a:\n    runs-on: weave-ci\n');
    workflow('nightly.yaml', 'jobs:\n  b:\n    runs-on: nightly-box\n');
    expect(requestedRunnerLabels(dir).sort()).toEqual(['nightly-box', 'weave-ci']);
  });
});

describe('runnerGaps (VS-467)', () => {
  it('names the requested labels no online runner serves', () => {
    expect(runnerGaps(['weave-ci', 'fast-box'], ['weave-ci', 'ubuntu-latest'])).toEqual(['fast-box']);
  });

  it('is empty when every requested label is online, or when nothing is requested', () => {
    expect(runnerGaps(['weave-ci'], ['weave-ci'])).toEqual([]);
    expect(runnerGaps([], ['weave-ci'])).toEqual([]);
  });
});
