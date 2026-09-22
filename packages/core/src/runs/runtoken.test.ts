import { describe, expect, it } from 'vitest';
import { signRunToken, verifyRunToken, type RunTokenClaims } from './runtoken.js';

const secret = new Uint8Array(32).fill(7);
const base: RunTokenClaims = {
  workspaceId: 'ws', runId: 'r1', agentId: 'a1', agentKind: 'worker',
  projectId: null, ticketId: null, planId: null, roleId: null,
};

describe('run token claims (VS-659)', () => {
  it('round-trips the image-input form and the attachment directory', async () => {
    const token = await signRunToken(secret, { ...base, imageInput: 'path', attachmentDir: '/home/agent/.weave-attachments/r1' });
    const claims = await verifyRunToken(secret, token);
    expect(claims.imageInput).toBe('path');
    expect(claims.attachmentDir).toBe('/home/agent/.weave-attachments/r1');
  });

  it('leaves both absent when the run is native', async () => {
    const claims = await verifyRunToken(secret, await signRunToken(secret, { ...base, imageInput: 'native' }));
    expect(claims.imageInput).toBe('native');
    expect(claims.attachmentDir).toBeUndefined();
  });

  it('leaves both absent when nothing declares a form', async () => {
    const claims = await verifyRunToken(secret, await signRunToken(secret, base));
    expect(claims.imageInput).toBeUndefined();
    expect(claims.attachmentDir).toBeUndefined();
  });
});