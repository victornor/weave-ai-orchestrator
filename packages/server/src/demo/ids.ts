import { createHash } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * VS-770: a stable 26-character identifier derived from a label, shaped like the ULIDs the product
 * mints so every id check and sort order that expects one still holds. The same label is the same id
 * on every seed; the leading character stays below `8` so it is a valid ULID timestamp prefix.
 */
export function demoId(label: string): string {
  const digest = createHash('sha256').update(`weave-demo:${label}`).digest();
  let out = '';
  for (let i = 0; i < 26; i += 1) out += CROCKFORD[digest[i]! % 32];
  return `0${out.slice(1)}`;
}
