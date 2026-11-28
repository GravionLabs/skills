// The Objective of the tests of an Objective run (`deliver-loop --objective x/app#1`), as `tracker/fake.mts` reads it.
import type { Scenario } from './run-loop';

/** An Objective in `x/app` over `x/app`, `x/lib` and `x/cli`; `features` by repository. */
export function objective(
  features: Record<
    string,
    { body?: string; milestone?: string; labels?: string[]; work: number[] }[]
  >,
  extra: Record<
    string,
    { number: number; title: string; labels?: string[]; addedAfter?: number }[]
  > = {},
  milestones: Record<string, { title: string; closed: boolean }[]> = {},
): Scenario {
  let next = 100;
  const repositories: Record<string, { issues: unknown[]; milestones?: unknown[] }> = {};
  const children: string[] = [];
  for (const name of ['x/app', 'x/lib', 'x/cli']) {
    const issues: unknown[] =
      name === 'x/app' ? [{ number: 1, title: '[Objective] o', labels: ['objective'] }] : [];
    for (const feature of features[name] ?? []) {
      next += 1;
      children.push(`${name}#${next}`);
      issues.push({
        number: next,
        title: '[Feature] f',
        milestone: feature.milestone ?? 'M001',
        body: feature.body ?? '',
        labels: ['feature', ...(feature.labels ?? [])],
        subIssues: [...feature.work, ...(extra[name] ?? []).map((i) => i.number)],
      });
      for (const nr of feature.work)
        issues.push({ number: nr, title: `[PBI] feat: work ${nr}`, labels: ['pbi'] });
    }
    for (const issue of extra[name] ?? []) issues.push({ labels: ['pbi'], ...issue });
    repositories[name] = {
      issues,
      milestones: milestones[name] ?? [{ title: 'M001', closed: false }],
    };
  }
  const objectiveIssue = repositories['x/app']?.issues[0] as Record<string, unknown>;
  objectiveIssue.body = '## Affected repos\n- x/app\n- x/lib\n- x/cli';
  objectiveIssue.subIssues = children;
  return { items: [], repositories };
}
