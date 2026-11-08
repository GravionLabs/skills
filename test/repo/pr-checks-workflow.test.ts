import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

const root = path.resolve(__dirname, '../..');
const text = fs.readFileSync(path.join(root, '.github/workflows/pr-checks.yml'), 'utf-8');
const wf = parse(text);
const job = wf.jobs['pr-checks'];

// #102 title, #71 readiness of GravionLabs/ci pr-checks.yml; the rulesets require "pr-checks / PR checks".
describe('pr-checks.yml', () => {
  it('runs on pull requests into main and release/**, on body, label and draft changes too', () => {
    expect(Object.keys(wf.on)).toEqual(['pull_request']);
    expect(wf.on.pull_request.branches).toEqual(['main', 'release/**']);
    expect(wf.on.pull_request.types).toEqual([
      'opened',
      'edited',
      'synchronize',
      'reopened',
      'labeled',
      'unlabeled',
      'ready_for_review',
    ]);
  });

  it('calls pr-checks.yml of a GravionLabs/ci release under the job id pr-checks', () => {
    expect(Object.keys(wf.jobs)).toEqual(['pr-checks']);
    expect(job.uses).toBe('GravionLabs/ci/.github/workflows/pr-checks.yml@v1');
    expect(job.steps).toBeUndefined();
  });

  // #71: readiness with require-issue: true and title run; adr and spec skip green without a governance key.
  it('keeps every input at its default, so readiness requires a closed issue', () => {
    expect(job.with).toBeUndefined();
  });

  // GitHub validates the permissions of every called job at startup, skipped ones included: the caller grants the
  // union of readiness, adr and title of ci v1.5.0, read-only (less ended in startup_failure on PR #125).
  it('grants nothing at top level, the read-only union of the called jobs to the job, and passes no secrets', () => {
    expect(wf.permissions).toEqual({});
    expect(job.permissions).toEqual({
      contents: 'read',
      issues: 'read',
      'pull-requests': 'read',
    });
    expect(job.secrets).toBeUndefined();
    expect(text).not.toContain('pull_request_target');
  });
});

describe('GravionLabs/ci node/setup pin', () => {
  it.each(['.github/workflows/ci.yml'])(
    '%s follows node/setup on the major tag v1, without a SHA pin',
    (rel) => {
      const wfText = fs.readFileSync(path.join(root, rel), 'utf-8');
      const refs = wfText.match(/GravionLabs\/ci\/node\/setup@.*/g) ?? [];
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) {
        expect(ref).toBe('GravionLabs/ci/node/setup@v1');
      }
    },
  );
});
