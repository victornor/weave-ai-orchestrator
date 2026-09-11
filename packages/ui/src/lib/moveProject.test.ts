import { describe, expect, it } from 'vitest';
import { project } from '../test/factories';
import { addProjectBody, moveProject, MoveProjectError } from './moveProject';

describe('addProjectBody', () => {
  it('copies the git URL and project settings for POST /projects', () => {
    const p = project({
      slug: 'vfuf',
      name: 'vfuf',
      gitUrl: 'git@example.com:v/vfuf.git',
      defaultBranch: 'main',
      landingBranch: 'edge',
      maxWorkers: 3,
      setupCommand: 'pnpm i',
      policies: { autoMergeDefault: false },
    });
    expect(addProjectBody(p)).toEqual({
      url: 'git@example.com:v/vfuf.git',
      id: 'vfuf',
      name: 'vfuf',
      defaultBranch: 'main',
      landingBranch: 'edge',
      maxWorkers: 3,
      setupCommand: 'pnpm i',
      policies: { autoMergeDefault: false },
    });
  });

  it('omits a null landing branch and setup command', () => {
    expect(addProjectBody(project({ landingBranch: null, setupCommand: null }))).not.toHaveProperty('landingBranch');
    expect(addProjectBody(project({ landingBranch: null, setupCommand: null }))).not.toHaveProperty('setupCommand');
  });
});

describe('moveProject', () => {
  it('POSTs dest then DELETEs source', async () => {
    const writes: string[] = [];
    await moveProject({
      project: project(),
      listDestProjects: async () => [],
      addToDest: async () => { writes.push('post'); },
      archiveSource: async () => { writes.push('delete'); },
    });
    expect(writes).toEqual(['post', 'delete']);
  });

  it('a dest slug clash, including an archived dest row, never writes', async () => {
    const writes: string[] = [];
    await expect(moveProject({
      project: project({ slug: 'api' }),
      listDestProjects: async () => [project({ slug: 'api', status: 'archived' })],
      addToDest: async () => { writes.push('post'); },
      archiveSource: async () => { writes.push('delete'); },
    })).rejects.toBeInstanceOf(MoveProjectError);
    await expect(moveProject({
      project: project({ slug: 'api' }),
      listDestProjects: async () => [project({ slug: 'api', status: 'archived' })],
      addToDest: async () => { writes.push('post'); },
      archiveSource: async () => { writes.push('delete'); },
    })).rejects.toMatchObject({ kind: 'slug_clash' });
    expect(writes).toEqual([]);
  });

  it('a dest POST failure never DELETEs', async () => {
    const writes: string[] = [];
    await expect(moveProject({
      project: project(),
      listDestProjects: async () => [],
      addToDest: async () => { writes.push('post'); throw new Error('clone refused'); },
      archiveSource: async () => { writes.push('delete'); },
    })).rejects.toMatchObject({ kind: 'add_failed' });
    expect(writes).toEqual(['post']);
  });

  it('an archive failure after dest add is archive_failed', async () => {
    const writes: string[] = [];
    await expect(moveProject({
      project: project(),
      listDestProjects: async () => [],
      addToDest: async () => { writes.push('post'); },
      archiveSource: async () => { writes.push('delete-attempt'); throw new Error('still has workers'); },
    })).rejects.toMatchObject({ kind: 'archive_failed' });
    expect(writes).toEqual(['post', 'delete-attempt']);
  });
});
