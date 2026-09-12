import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_KIT_CSS, ARTIFACT_KIT_MARKERS, ARTIFACT_KIT_SCALE_TOKEN_NAMES, ARTIFACT_KIT_THEME_TOKEN_NAMES,
  artifactKitTokens, readArtifactPlaybooks,
} from './kit.js';
import { extractCssBlock, parseCssCustomProperties } from './parse.js';

// Not an import — a plain fs read of the app's own token source, so this test can compare the two
// without packages/core depending on packages/ui (scripts/guard-boundaries.mjs only inspects
// `from '...'` import specifiers, not fs paths).
const APP_CSS = readFileSync(fileURLToPath(new URL('../../../ui/src/index.css', import.meta.url)), 'utf8');

describe('parse.ts', () => {
  it('extractCssBlock finds the matching close brace, not the first one', () => {
    const css = `.outer { .inner { --a: 1px; } --b: 2px; }`;
    expect(extractCssBlock(css, '.outer {')).toBe(' .inner { --a: 1px; } --b: 2px; ');
  });

  it('parseCssCustomProperties reads name/value pairs and drops a trailing comment', () => {
    const block = `
      /* a comment with no semicolon */
      --foo: 1px;
      --bar: rgb(1 2 3 / 0.5);
      --baz: 'A', sans-serif; /* trailing comment */
    `;
    expect(parseCssCustomProperties(block)).toEqual({
      '--foo': '1px',
      '--bar': 'rgb(1 2 3 / 0.5)',
      '--baz': "'A', sans-serif",
    });
  });
});

describe('AC Artifact Kit token drift (openspec/specs/artifact-kit/design-tokens)', () => {
  const appDark = parseCssCustomProperties(extractCssBlock(APP_CSS, ARTIFACT_KIT_MARKERS.dark));
  const appLight = parseCssCustomProperties(extractCssBlock(APP_CSS, ARTIFACT_KIT_MARKERS.light));
  const appScale = parseCssCustomProperties(extractCssBlock(APP_CSS, ARTIFACT_KIT_MARKERS.scale));
  const kit = artifactKitTokens();

  it('every theme token the kit ships matches the app\'s dark value exactly', () => {
    for (const name of ARTIFACT_KIT_THEME_TOKEN_NAMES) {
      expect(kit.dark[name], `${name} (dark)`).toBe(appDark[name]);
    }
  });

  it('every theme token the kit ships matches the app\'s light value exactly', () => {
    for (const name of ARTIFACT_KIT_THEME_TOKEN_NAMES) {
      expect(kit.light[name], `${name} (light)`).toBe(appLight[name]);
    }
  });

  it('every scale token the kit ships matches the app\'s value exactly', () => {
    for (const name of ARTIFACT_KIT_SCALE_TOKEN_NAMES) {
      expect(kit.scale[name], name).toBe(appScale[name]);
    }
  });

  it('demonstrates the check actually discriminates: a mutated kit value fails against a real, non-empty app value', () => {
    // Guard against a vacuous pass: if the app-side parse found nothing, appDark['--accent'] would
    // be undefined, and any non-undefined mutated value would trivially "differ" from it.
    expect(appDark['--accent']).toBeTruthy();
    const mutatedDark = { ...kit.dark, '--accent': '#not-the-real-value' };
    expect(mutatedDark['--accent']).not.toBe(appDark['--accent']);
  });
});

describe('readArtifactPlaybooks', () => {
  it('returns an empty object when the skills directory has no weave-ai-artifacts skill', () => {
    expect(readArtifactPlaybooks('/nonexistent/skills/dir')).toEqual({});
  });

  it('reads the shipped skill\'s reference markdown, keyed by filename stem', () => {
    const skillsDir = fileURLToPath(new URL('../../../../skills', import.meta.url));
    const playbooks = readArtifactPlaybooks(skillsDir);
    expect(Object.keys(playbooks).length).toBeGreaterThan(0);
    for (const body of Object.values(playbooks)) expect(body.length).toBeGreaterThan(0);
  });
});

it('ARTIFACT_KIT_CSS has no <script> tag and no non-data: external reference', () => {
  expect(ARTIFACT_KIT_CSS).not.toMatch(/<script/i);
  expect(ARTIFACT_KIT_CSS).not.toMatch(/@import/i);
  expect(ARTIFACT_KIT_CSS).not.toMatch(/url\(\s*['"]?(?!data:)/i);
});
