import { describe, expect, it } from 'vitest';
import { renderTemplate, truthy } from './template.js';
import { definitionOfDone, parseAcceptance } from './index.js';

describe('template engine', () => {
  it('resolves dotted paths and drops unknown ones', () => {
    expect(renderTemplate('Hi {{human.name}} of {{workspace.name}}{{nope.missing}}', { human: { name: 'captain' }, workspace: { name: 'Acme' } }))
      .toBe('Hi captain of Acme');
  });

  it('renders each blocks with {{this}} and field access', () => {
    const out = renderTemplate('{{#each items}}- {{this}}\n{{/each}}', { items: ['a', 'b'] });
    expect(out).toBe('- a\n- b\n');
    const objs = renderTemplate('{{#each rows}}{{name}}={{value}};{{/each}}', { rows: [{ name: 'x', value: 1 }, { name: 'y', value: 2 }] });
    expect(objs).toBe('x=1;y=2;');
  });

  it('honours if and unless, including empty arrays and strings', () => {
    const t = '{{#if a}}A{{/if}}{{#unless b}}B{{/unless}}{{#if list}}L{{/if}}';
    expect(renderTemplate(t, { a: 'yes', b: '', list: [] })).toBe('AB');
    expect(renderTemplate(t, { a: '', b: 'set', list: [1] })).toBe('L');
  });

  it('keeps outer scope visible inside blocks', () => {
    expect(renderTemplate('{{#each xs}}{{human.name}}:{{this}} {{/each}}', { human: { name: 'cap' }, xs: [1, 2] })).toBe('cap:1 cap:2 ');
  });

  it('nests blocks', () => {
    const out = renderTemplate('{{#if on}}{{#each xs}}[{{this}}]{{/each}}{{/if}}', { on: true, xs: ['a', 'b'] });
    expect(out).toBe('[a][b]');
  });

  it('survives unbalanced tags instead of throwing', () => {
    expect(() => renderTemplate('{{#if a}}dangling', { a: 1 })).not.toThrow();
    expect(() => renderTemplate('{{/each}}stray', {})).not.toThrow();
  });

  it('treats empty containers as falsy', () => {
    expect(truthy([])).toBe(false);
    expect(truthy({})).toBe(false);
    expect(truthy(' ')).toBe(false);
    expect(truthy(0)).toBe(false);
    expect(truthy(['x'])).toBe(true);
  });
});

describe('brief helpers', () => {
  it('extracts acceptance criteria bullets from a description', () => {
    const desc = 'Do the thing.\n\n## Acceptance criteria\n- it works\n- tests pass\n\n## Notes\n- ignored';
    expect(parseAcceptance(desc)).toEqual(['it works', 'tests pass']);
    expect(parseAcceptance('no criteria here')).toEqual([]);
  });

  it('states a definition of done per kind and delivery mode', () => {
    expect(definitionOfDone('change', 'pr')).toContain('open a PR');
    expect(definitionOfDone('scout', 'pr')).toContain('report');
    expect(definitionOfDone('question', 'pr')).toContain('weave_ticket_comment');
    expect(definitionOfDone('operational', 'pr')).toContain('action_approval');
    expect(definitionOfDone('operational', 'pr')).toContain('unlanded');
    expect(definitionOfDone('operational', 'pr')).toContain('not a second authorisation');
    expect(definitionOfDone('operational', 'pr')).not.toContain('open a PR');
  });

  it('gives a task both endings: in_review for a diff, done with a stated ending otherwise (VS-215)', () => {
    const pr = definitionOfDone('task', 'pr');
    expect(pr).toContain('in_review');
    expect(pr).toContain('`done`');
    expect(pr).toContain('transition note');
    expect(pr).toContain('refused');
    const local = definitionOfDone('task', 'local-branch');
    expect(local).toContain('in_review');
    expect(local).toContain('`done`');
    expect(local).toContain('refused');
  });
});
