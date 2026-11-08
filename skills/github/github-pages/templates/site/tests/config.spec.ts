import type { UserConfig } from 'vitepress';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** The site config, imported fresh so that SITE_BASE is read again. */
async function loadConfig(): Promise<UserConfig> {
  vi.resetModules();
  return (await import('../.vitepress/config.mts')).default as UserConfig;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the VitePress config', () => {
  it('uses / as base when SITE_BASE is not set', async () => {
    vi.stubEnv('SITE_BASE', undefined);
    expect((await loadConfig()).base).toBe('/');
  });

  it('takes the base from SITE_BASE', async () => {
    vi.stubEnv('SITE_BASE', '/repo/');
    expect((await loadConfig()).base).toBe('/repo/');
  });

  it('fails the build on dead links', async () => {
    expect((await loadConfig()).ignoreDeadLinks).toBe(false);
  });
});
