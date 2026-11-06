import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv from 'ajv/dist/2020';

const read = (p: string) =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf-8'));

const schemaPath = 'skills/delivery/deliver/schema/deliver-loop-status.schema.json';
const validate = new Ajv({ allErrors: true }).compile(read(schemaPath));
const fixture = (name: string) => read(`test/skills/delivery/fixtures/${name}.json`);

describe('deliver-loop-status.schema.json (#332)', () => {
  it.each(['closed', 'total'])('describes %s as PBIs and Bugs only (#357)', (key) => {
    const desc: string = read(schemaPath).properties[key].description ?? '';
    expect(desc).toMatch(/pbi/i);
    expect(desc).toMatch(/bug/i);
    expect(desc).toMatch(/Features and Epics excluded/);
  });

  it.each(['running', 'blocked', 'done'])('accepts the %s fixture', (name) => {
    const ok = validate(fixture(`deliver-loop-status-${name}`));
    expect(ok, JSON.stringify(validate.errors)).toBe(true);
  });

  it.each([
    'schemaVersion',
    'run',
    'harness',
    'model',
    'repository',
    'milestone',
    'closed',
    'total',
    'current',
    'delivered',
    'blocked',
    'paused',
    'needsYou',
    'release',
    'startedAt',
    'updatedAt',
    'result',
  ])('rejects a running status without %s', (key) => {
    const doc: any = fixture('deliver-loop-status-running');
    delete doc[key];
    expect(validate(doc)).toBe(false);
  });

  it('accepts unknown fields at the top level and in nested objects', () => {
    const doc: any = fixture('deliver-loop-status-running');
    doc.futureField = { anything: true };
    doc.current.step.extra = 1;
    doc.milestone.extra = 'x';
    expect(validate(doc)).toBe(true);
  });

  it('rejects another schemaVersion', () => {
    expect(validate({ ...fixture('deliver-loop-status-running'), schemaVersion: 2 })).toBe(false);
  });

  it('rejects a result outside the five states', () => {
    expect(validate({ ...fixture('deliver-loop-status-running'), result: 'stopped' })).toBe(false);
  });

  it('accepts each of the five result states', () => {
    for (const result of ['running', 'done', 'max reached', 'blocked', 'no progress']) {
      expect(validate({ ...fixture('deliver-loop-status-running'), result })).toBe(true);
    }
  });

  it('rejects a step outside 1/7 to 7/7', () => {
    const doc: any = fixture('deliver-loop-status-running');
    doc.current.step.n = 8;
    expect(validate(doc)).toBe(false);
    doc.current.step.n = 3;
    doc.current.step.total = 6;
    expect(validate(doc)).toBe(false);
  });

  it('rejects a timestamp that is not ISO 8601', () => {
    expect(
      validate({ ...fixture('deliver-loop-status-running'), updatedAt: '06.11.2026 10:41' }),
    ).toBe(false);
  });

  it('rejects a blocked item without a reason', () => {
    const doc: any = fixture('deliver-loop-status-blocked');
    delete doc.blocked[0].reason;
    expect(validate(doc)).toBe(false);
  });
});
