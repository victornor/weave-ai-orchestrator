import { describe, expect, it } from 'vitest';
import type { ProviderProfile } from '@weave-ai/shared';
import { FakeRuntime, type RuntimeAdapter } from '@weave-ai/runtime-sdk';
import { createRegistries, type WorkspaceContext } from '../context.js';
import { imageAttachmentForm } from './image-input.js';

const profile = (image?: 'none' | 'user' | 'user_and_tool'): ProviderProfile => ({
  baseUrl: 'https://api.example/v1', auth: 'bearer', headers: {}, models: {},
  ...(image ? { compat: { image: { input: image } } } : {}),
}) as ProviderProfile;

const providerWithModel = (modelId: string, image: 'none' | 'user' | 'user_and_tool'): ProviderProfile => ({
  baseUrl: 'https://api.example/v1', auth: 'bearer', headers: {}, models: { [modelId]: { compat: { image: { input: image } } } },
}) as ProviderProfile;

function ctxFor(capability: 'native' | 'path' | 'model' | undefined, providers: Record<string, ProviderProfile> = {}) {
  const registries = createRegistries();
  if (capability !== undefined) {
    const rt = new FakeRuntime();
    rt.imageInput = capability;
    registries.runtimes.set(rt.id, rt as RuntimeAdapter);
  }
  return { registries, daemon: { providers } } as unknown as Pick<WorkspaceContext, 'registries' | 'daemon'>;
}

describe('imageAttachmentForm (VS-659)', () => {
  it('returns native for a runtime that declares it', () => {
    expect(imageAttachmentForm(ctxFor('native'), 'fake', null)).toBe('native');
  });

  it('returns path for a runtime that declares it', () => {
    expect(imageAttachmentForm(ctxFor('path'), 'fake', null)).toBe('path');
  });

  it('treats an undeclared runtime as path — the safe form', () => {
    expect(imageAttachmentForm(ctxFor(undefined), 'unknown-runtime', null)).toBe('path');
  });

  it('resolves a model-form runtime to path when the profile turns images off', () => {
    const ctx = ctxFor('model', { p: profile('none') });
    expect(imageAttachmentForm(ctx, 'fake', 'p/m1')).toBe('path');
  });

  it('resolves a model-form runtime to native for a profile that takes images', () => {
    expect(imageAttachmentForm(ctxFor('model', { p: profile('user') }), 'fake', 'p/m1')).toBe('native');
    expect(imageAttachmentForm(ctxFor('model', { p: profile('user_and_tool') }), 'fake', 'p/m1')).toBe('native');
  });

  it('defaults a model-form runtime to native when the profile declares nothing (the codec default)', () => {
    expect(imageAttachmentForm(ctxFor('model', { p: profile() }), 'fake', 'p/m1')).toBe('native');
  });

  it('lets a per-model override turn images off under a profile that takes them', () => {
    const ctx = ctxFor('model', { p: providerWithModel('m1', 'none') });
    expect(imageAttachmentForm(ctx, 'fake', 'p/m1')).toBe('path');
  });
});