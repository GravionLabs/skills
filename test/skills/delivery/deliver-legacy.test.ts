import { describe, expect, it } from 'vitest';
import { appSettings } from '../../../skills/delivery/deliver/scripts/app-token.mts';
import {
  adoptLegacyEnv,
  unknownConfigKeys,
} from '../../../skills/delivery/deliver/scripts/legacy.mts';

// Names kept for one release (#694): DELIVER_MIN_* variables and the dropped keys of `deliver`.
describe('deliver legacy names', () => {
  it('reads DELIVER_MIN_X as DELIVER_X with one warning, the new name wins', () => {
    const env: NodeJS.ProcessEnv = {
      DELIVER_MIN_HARNESS: '["a"]',
      DELIVER_MIN_SESSION_TOKEN: 'old',
      DELIVER_SESSION_TOKEN: 'new',
    };
    const warnings = adoptLegacyEnv(env);
    expect(env['DELIVER_HARNESS']).toBe('["a"]');
    expect(env['DELIVER_SESSION_TOKEN']).toBe('new');
    expect(Object.keys(env).some((k) => k.startsWith('DELIVER_MIN_'))).toBe(false);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('DELIVER_MIN_HARNESS is deprecated');
    expect(adoptLegacyEnv({ DELIVER_HARNESS: 'x' })).toEqual([]);
  });

  it('reads the old app variables', () => {
    expect(appSettings({ DELIVER_MIN_APP_ID: '7', DELIVER_MIN_APP_KEY_FILE: '/k' })).toEqual({
      appId: '7',
      keyFile: '/k',
      keyCommand: undefined,
    });
  });

  it('warns once about unknown deliver keys', () => {
    expect(unknownConfigKeys({ base: 'main', harness: 'claude' })).toBeUndefined();
    expect(unknownConfigKeys(undefined)).toBeUndefined();
    const line = unknownConfigKeys({ roles: {}, parallel: 2, base: 'x' });
    expect(line).toContain('deliver.roles, deliver.parallel');
    expect(line).not.toContain('\n');
  });
});
