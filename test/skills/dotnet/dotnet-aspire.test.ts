import * as fs from 'fs';
import * as path from 'path';

const skillDir = path.resolve(__dirname, '../../../skills/dotnet/dotnet-aspire');
const read = (rel: string) => fs.readFileSync(path.join(skillDir, rel), 'utf8');

describe('dotnet-aspire skill', () => {
  const skill = read('SKILL.md');

  it('keeps SKILL.md within 100 lines and the name matches the folder', () => {
    expect(skill.trimEnd().split('\n').length).toBeLessThanOrEqual(100);
    expect(skill).toMatch(/^name: dotnet-aspire$/m);
  });

  it.each(['resources', 'telemetry', 'coexistence'])(
    'has references/%s.md linked from SKILL.md',
    (name) => {
      expect(fs.existsSync(path.join(skillDir, `references/${name}.md`))).toBe(true);
      expect(skill).toContain(`references/${name}.md`);
    },
  );

  it('names both AppHost forms and the case where Aspire does not fit', () => {
    expect(skill).toContain('apphost.cs');
    expect(skill).toContain('Aspire.AppHost.Sdk');
    expect(skill).toContain('Tauri');
  });

  it('covers the resource, telemetry and coexistence topics', () => {
    const resources = read('references/resources.md');
    for (const term of [
      'Postgres 18',
      'AddValkey',
      'WithRealmImport',
      'AddContainer',
      'AddProject',
      'AddViteApp',
      'AddExecutable',
      'WaitFor',
      'AddParameter',
    ]) {
      expect(resources).toContain(term);
    }
    const telemetry = read('references/telemetry.md');
    for (const term of [
      'ServiceDefaults',
      '@opentelemetry/sdk-node',
      'opentelemetry-otlp',
      'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    ]) {
      expect(telemetry).toContain(term);
    }
    expect(read('references/coexistence.md')).toContain('ADR');
  });

  it('is loaded by dotnet-implementation only on the aspire framework line', () => {
    const impl = fs
      .readFileSync(
        path.resolve(__dirname, '../../../skills/dotnet/dotnet-implementation/SKILL.md'),
        'utf8',
      )
      .split('\n');
    const lines = impl.filter((l) => l.includes('dotnet-aspire'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('frameworks: ["aspire"]');
  });
});
