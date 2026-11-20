import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

const root = path.resolve(__dirname, '../..');
const text = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf-8');
const wf = parse(text);
const job = wf.jobs['pr-checks'];

// #102 title, #71 readiness of GravionLabs/ci pr-checks.yml; the rulesets require "PR checks passed" (#836).
describe('pr-checks job of ci.yml', () => {
  it('is the only copy: pr-checks.yml is gone', () => {
    expect(fs.existsSync(path.join(root, '.github/workflows/pr-checks.yml'))).toBe(false);
  });

  it('runs on pull requests into main and release/**, on body, label and draft changes too', () => {
    expect(wf.on.pull_request).toBeDefined();
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
    expect(Object.keys(wf.jobs)).toContain('pr-checks');
    expect(job.if).toBe("github.event_name == 'pull_request'");
    expect(job.uses).toBe('GravionLabs/ci/.github/workflows/pr-checks.yml@v1');
    expect(job.steps).toBeUndefined();
  });

  // #71: readiness with require-issue: true and title run; adr and spec skip green without a governance key.
  it('keeps every input at its default, so readiness requires a closed issue', () => {
    expect(job.with).toBeUndefined();
  });

  // GitHub validates the permissions of every called job at startup, skipped ones included: the caller grants the
  // union of the called jobs; pull-requests: write since the retarget job of ci v1.14.0 (less ended in startup_failure on PR #125).
  it('grants the union of the called jobs to the job and passes no secrets', () => {
    expect(job.permissions).toEqual({
      contents: 'read',
      issues: 'read',
      'pull-requests': 'write',
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
