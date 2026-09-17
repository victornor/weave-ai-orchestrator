import { describe, expect, it } from 'vitest';
import { firstStderrReason } from '../src/adapter.js';

/**
 * Captured from codex-cli 0.154.0 on this host: a fatal startup reason arrives on stderr before any
 * JSON on stdout, and with pre-turn noise lines above it.
 */
describe('firstStderrReason', () => {
  it('skips startup noise and returns the fatal reason', () => {
    const stderr = [
      'WARNING: proceeding, even though we could not create PATH aliases: Refusing to create helper binaries under temporary dir "/tmp"',
      '2026-09-17T21:22:46.062456Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed',
      '',
      'Not inside a trusted directory and --skip-git-repo-check was not specified.',
    ].join('\n');
    expect(firstStderrReason(stderr)).toBe('Not inside a trusted directory and --skip-git-repo-check was not specified.');
  });

  it('returns null when stderr holds only noise or nothing', () => {
    expect(firstStderrReason('')).toBeNull();
    expect(firstStderrReason('WARNING: something\n\n  \n')).toBeNull();
  });

  it('returns the first real line even when it is the only one', () => {
    expect(firstStderrReason('MCP tool call requires approval, but approval policy is never')).toBe('MCP tool call requires approval, but approval policy is never');
  });
});
