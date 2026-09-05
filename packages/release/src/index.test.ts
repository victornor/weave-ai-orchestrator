import { describe, expect, it } from 'vitest';
import { LAUNCHD_LABEL, SERVICE_NAME, inOwnScope, planRestart } from './index.js';

describe('planRestart', () => {
  const base = { platform: 'linux' as NodeJS.Platform, unitInstalled: false, launchdInstalled: false, systemdRunAvailable: false };

  it('restarts through systemd and gives the runner its own scope when it can', () => {
    const plan = planRestart({ ...base, unitInstalled: true, systemdRunAvailable: true });
    expect(plan.restart).toEqual({ cmd: 'systemctl', args: ['--user', 'restart', SERVICE_NAME] });
    expect(plan.launch).toBe('systemd-run');
    expect(plan.runnerSurvives).toBe(true);
  });

  it('still restarts through systemd without systemd-run, but says the runner will not survive', () => {
    const plan = planRestart({ ...base, unitInstalled: true, systemdRunAvailable: false });
    expect(plan.restart).toEqual({ cmd: 'systemctl', args: ['--user', 'restart', SERVICE_NAME] });
    expect(plan.launch).toBe('detached');
    expect(plan.runnerSurvives).toBe(false);
  });

  it('kickstarts the launchd agent on macOS, where a detached child survives', () => {
    const plan = planRestart({ ...base, platform: 'darwin', launchdInstalled: true, uid: 501 });
    expect(plan.restart).toEqual({ cmd: 'launchctl', args: ['kickstart', '-k', `gui/501/${LAUNCHD_LABEL}`] });
    expect(plan.launch).toBe('detached');
    expect(plan.runnerSurvives).toBe(true);
  });

  it('falls back to stopping and starting the daemon when no service manager owns it', () => {
    const plan = planRestart(base);
    expect(plan.restart).toBeNull();
    expect(plan.launch).toBe('detached');
    expect(plan.runnerSurvives).toBe(true);
    expect(planRestart({ ...base, platform: 'darwin' }).restart).toBeNull();
    expect(planRestart({ ...base, platform: 'win32', unitInstalled: true }).restart).toBeNull();
  });

  it('wraps a command into a transient scope', () => {
    expect(inOwnScope('ac-upgrade-1', 'node', ['bin.js', 'x'])).toEqual({
      cmd: 'systemd-run',
      args: ['--user', '--scope', '--collect', '--unit=ac-upgrade-1', '--quiet', 'node', 'bin.js', 'x'],
    });
  });
});
