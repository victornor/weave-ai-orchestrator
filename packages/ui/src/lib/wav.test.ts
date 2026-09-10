import { describe, expect, it } from 'vitest';
import { downsampleTo16k, encodePcm16MonoWav, encodePcm16MonoWavBytes } from './wav';

describe('encodePcm16MonoWav', () => {
  it('writes a valid 16 kHz mono WAV header around known PCM', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = encodePcm16MonoWav(samples, 16000);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + samples.length * 2);
    const buf = encodePcm16MonoWavBytes(samples, 16000);
    expect(String.fromCharCode(...buf.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...buf.slice(8, 12))).toBe('WAVE');
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
  });
});

describe('downsampleTo16k', () => {
  it('is a no-op at 16 kHz', () => {
    const s = new Float32Array([0.1, 0.2]);
    expect(downsampleTo16k(s, 16000)).toBe(s);
  });

  it('halves a 32 kHz buffer', () => {
    const s = new Float32Array([0, 1, 0, 1, 0, 1, 0, 1]);
    expect(downsampleTo16k(s, 32000).length).toBe(4);
  });
});
