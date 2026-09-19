import { describe, expect, it } from 'vitest';
import { MEMORY_MB, baseMemoryMb, parseCgroupMemoryMax } from './memory.js';

describe('worker memory base', () => {
  it('parses a cgroup memory.max value', () => {
    expect(parseCgroupMemoryMax('8589934592')).toBe(8589934592);
    expect(parseCgroupMemoryMax('max')).toBeNull();
    expect(parseCgroupMemoryMax('')).toBeNull();
    expect(parseCgroupMemoryMax(null)).toBeNull();
  });

  it('uses the host total when the cgroup is unlimited', () => {
    expect(baseMemoryMb({ totalBytes: 16 * MEMORY_MB * 1024, cgroupMax: 'max' })).toBe(16 * 1024);
  });

  it('uses the smaller of the cgroup ceiling and the host total', () => {
    expect(baseMemoryMb({ totalBytes: 64 * MEMORY_MB * 1024, cgroupMax: String(8 * MEMORY_MB * 1024) })).toBe(8 * 1024);
    expect(baseMemoryMb({ totalBytes: 4 * MEMORY_MB * 1024, cgroupMax: String(8 * MEMORY_MB * 1024) })).toBe(4 * 1024);
  });
});
