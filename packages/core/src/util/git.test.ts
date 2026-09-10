import { describe, expect, it } from 'vitest';
import { githubSshRemote } from './git.js';

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
