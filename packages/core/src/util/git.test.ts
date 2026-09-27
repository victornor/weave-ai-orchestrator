import { describe, expect, it, vi } from 'vitest';
import type { ExecResult } from './exec.js';
import { githubSshRemote, isTransientGitFetchError, fetchOriginWithRetry } from './git.js';

const ok = (stdout = ''): ExecResult => ({ ok: true, exitCode: 0, stdout, stderr: '', failed: false });
const fail = (stderr: string): ExecResult => ({ ok: false, exitCode: 1, stdout: '', stderr, failed: true });

describe('githubSshRemote', () => {
  it.each([
    ['https://github.com/victornor/WidgetShop', 'git@github.com:victornor/WidgetShop.git'],
    ['https://github.com/victornor/WidgetShop.git', 'git@github.com:victornor/WidgetShop.git'],
    ['https://github.com/victornor/WidgetShop/', 'git@github.com:victornor/WidgetShop.git'],
    ['http://github.com/victornor/WidgetShop.git', 'git@github.com:victornor/WidgetShop.git'],
    ['github.com/victornor/WidgetShop', 'git@github.com:victornor/WidgetShop.git'],
    ['git@github.com:victornor/WidgetShop.git', 'git@github.com:victornor/WidgetShop.git'],
    ['ssh://git@github.com/victornor/WidgetShop.git', 'git@github.com:victornor/WidgetShop.git'],
    ['https://user:token@github.com/acme/api.git', 'git@github.com:acme/api.git'],
    ['  https://github.com/acme/api.git  ', 'git@github.com:acme/api.git'],
    ['HTTPS://GITHUB.COM/Acme/Api.git', 'git@github.com:Acme/Api.git'],
  ])('%s → SSH', (input, want) => {
    expect(githubSshRemote(input)).toBe(want);
  });

  it.each([
    'https://gitlab.com/acme/api.git',
    '/srv/git/acme/api',
    'https://github.com/victornor/WidgetShop/tree/main',
    'https://gist.github.com/user/abc',
    'git@gitlab.com:acme/api.git',
  ])('leaves %s unchanged', (input) => {
    expect(githubSshRemote(input)).toBe(input);
  });
});

// VS-717: a transient GitHub SSH connect timeout on the primary-clone fetch parked a worker for a
// human retry twice in 17 hours (VS-703, VS-716) even though a plain retry worked both times.
describe('isTransientGitFetchError', () => {
  it('classifies the exact connect-timeout text from VS-703/VS-716 as transient', () => {
    const stderr = 'ssh: connect to host github.com port 22: Connection timed out\nfatal: Could not read from remote repository.';
    expect(isTransientGitFetchError(stderr)).toBe(true);
  });

  it('does not classify an auth failure as transient', () => {
    const stderr = 'Permission denied (publickey).\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.';
    expect(isTransientGitFetchError(stderr)).toBe(false);
  });

  it.each([
    'ssh: Could not resolve hostname github.com: Name or service not known',
    'fatal: unable to access \'https://github.com/acme/api.git/\': Could not resolve host: github.com',
    'kex_exchange_identification: Connection closed by remote host',
    'ssh: connect to host github.com port 22: Connection refused',
  ])('classifies %s as transient', (stderr) => {
    expect(isTransientGitFetchError(stderr)).toBe(true);
  });

  it.each([
    'remote: Repository not found.\nfatal: repository \'https://github.com/acme/gone.git/\' not found',
    'fatal: \'/tmp/nonexistent-remote\' does not appear to be a git repository\nfatal: Could not read from remote repository.',
  ])('does not classify %s as transient', (stderr) => {
    expect(isTransientGitFetchError(stderr)).toBe(false);
  });
});

describe('fetchOriginWithRetry', () => {
  it('retries a transient failure and returns the eventual success', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce(fail('ssh: connect to host github.com port 22: Connection timed out'))
      .mockResolvedValueOnce(ok());
    const onAttempt = vi.fn();
    const sleep = vi.fn(async () => {});

    const { result, attempts } = await fetchOriginWithRetry('/repo', 300_000, { run, sleep, onAttempt });

    expect(result.ok).toBe(true);
    expect(attempts).toBe(2);
    expect(run).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(30_000);
    expect(onAttempt).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, willRetry: true }));
  });

  it('parks after the bounded retries when a transient failure never clears', async () => {
    const stderr = 'ssh: connect to host github.com port 22: Connection timed out';
    const run = vi.fn().mockResolvedValue(fail(stderr));
    const onAttempt = vi.fn();
    const sleep = vi.fn(async () => {});

    const { result, attempts } = await fetchOriginWithRetry('/repo', 300_000, { run, sleep, onAttempt });

    expect(result.ok).toBe(false);
    expect(attempts).toBe(3);
    expect(run).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 30_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 90_000);
    expect(onAttempt.mock.calls.map((c) => c[0].willRetry)).toEqual([true, true, false]);
  });

  it('fails a non-transient error on the first attempt, with no retry', async () => {
    const run = vi.fn().mockResolvedValue(fail('Permission denied (publickey).\nfatal: Could not read from remote repository.'));
    const onAttempt = vi.fn();
    const sleep = vi.fn(async () => {});

    const { result, attempts } = await fetchOriginWithRetry('/repo', 300_000, { run, sleep, onAttempt });

    expect(result.ok).toBe(false);
    expect(attempts).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(onAttempt).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, attempts: 3, willRetry: false }));
  });
});
