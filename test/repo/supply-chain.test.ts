import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

const root = path.resolve(__dirname, '../..');
const workflowDir = path.join(root, '.github/workflows');
const workflows = fs.readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f));
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

describe('supply chain: 7-day minimum release age and pinned actions (#730)', () => {
  it('pnpm holds back releases younger than 7 days', () => {
    expect(parse(read('pnpm-workspace.yaml')).minimumReleaseAge).toBe(7 * 24 * 60);
  });

  it('the Renovate config extends the shared preset and sets no release age of its own', () => {
    const text = read('.github/renovate.json5');
    expect(text).toContain("'github>GravionLabs/ci'");
    expect(text).not.toMatch(/minimumReleaseAge/);
    // the preset pins action digests; GravionLabs/ci stays on its major tag (ci-major-tag.test.ts)
    expect(text).toMatch(
      /matchPackageNames: \['GravionLabs\/ci', 'GravionLabs\/ci\/\*\*'\],\s*pinDigests: false/,
    );
  });

  it('the Renovate workflow names the repository and the config, and runs only here', () => {
    const job = parse(read('.github/workflows/renovate.yml')).jobs.renovate;
    expect(job.if).toBe("github.repository == 'GravionLabs/skills'");
    const step = job.steps.find((s: { uses?: string }) =>
      s.uses?.startsWith('renovatebot/github-action@'),
    );
    expect(step.with.configurationFile).toBe('.github/renovate.json5');
    // without the repository Renovate ends green and does nothing
    expect(step.env.RENOVATE_REPOSITORIES).toMatch(/github\.repository/);
  });

  it.each(workflows)(
    '%s names every action outside GravionLabs/ by commit SHA with the version as comment',
    (file) => {
      const offenders = read(`.github/workflows/${file}`)
        .split('\n')
        .filter((line) => /^\s*(- )?uses:/.test(line))
        .filter((line) => !/uses:\s*(GravionLabs\/|\.\/)/.test(line))
        .filter((line) => !/@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(line));
      expect(offenders).toEqual([]);
    },
  );
});
