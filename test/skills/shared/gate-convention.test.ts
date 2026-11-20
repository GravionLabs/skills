import Ajv2020 from 'ajv/dist/2020';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8');
const impl = 'skills/shared/implementation';
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
  JSON.parse(read(`${impl}/schema/config.schema.json`)),
);

describe('config schema: gate', () => {
  it.each([{ gate: 'pnpm check:changed' }, { gate: false }])('accepts %j', (cfg) => {
    expect(validate(cfg)).toBe(true);
  });
  it.each([{ gate: true }, { gate: '' }, { gate: 1 }, { gate: ['a'] }, { gate: {} }])(
    'rejects %j',
    (cfg) => {
      expect(validate(cfg)).toBe(false);
    },
  );
});

describe('gate convention', () => {
  const gate = read(`${impl}/references/gate.md`);
  it('states name, cache, --base, worker limit and the stack mapping', () => {
    for (const t of [
      'check:changed',
      'Pass cache',
      '--base=<ref>',
      'GATE_MAX_WORKERS',
      'min(4, cores / 2)',
      '--no-verify',
      'dotnet format',
      'cargo clippy',
      'ruff',
      'pyright',
      'pytest',
    ]) {
      expect(gate).toContain(t);
    }
  });
  it('has the AGENTS.md checks template', () => {
    const t = read(`${impl}/templates/agents-checks.md`);
    expect(t).toMatch(/^## Checks/);
    expect(t).toContain('--no-verify');
    expect(t).toContain('timeout');
  });
  it('is linked from SKILL.md, which stays within 100 lines', () => {
    const s = read(`${impl}/SKILL.md`);
    expect(s).toContain('references/gate.md');
    expect(s.split('\n').length).toBeLessThanOrEqual(100);
  });
  it('is documented in project-config.md', () => {
    expect(read('site/usage/project-config.md')).toContain('- `gate`:');
  });
});
