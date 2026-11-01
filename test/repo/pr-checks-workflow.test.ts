import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

const root = path.resolve(__dirname, '../..');
const text = fs.readFileSync(path.join(root, '.github/workflows/pr-checks.yml'), 'utf-8');
const wf = parse(text);
const job = wf.jobs['pr-checks'];

// #102: the PR title check of GravionLabs/ci#108; the rulesets require "pr-checks / PR checks".
describe('pr-checks.yml', () => {
  it('runs on pull requests into main and release/**, title edits included', () => {
    expect(Object.keys(wf.on)).toEqual(['pull_request']);
    expect(wf.on.pull_request.branches).toEqual(['main', 'release/**']);
    expect(wf.on.pull_request.types).toEqual(
      expect.arrayContaining(['opened', 'edited', 'synchronize']),
    );
  });

  it('calls pr-checks.yml of a GravionLabs/ci release under the job id pr-checks', () => {
    expect(Object.keys(wf.jobs)).toEqual(['pr-checks']);
    expect(job.uses).toBe('GravionLabs/ci/.github/workflows/pr-checks.yml@v1.5.0');
    expect(job.steps).toBeUndefined();
  });

  it('runs only the title job', () => {
    expect(job.with).toEqual({ readiness: false, adr: false, spec: false, title: true });
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
  it.each(['.github/workflows/ci.yml', '.github/workflows/pages.yml'])(
    '%s pins node/setup to the commit of ci v1.5.0',
    (rel) => {
      const wfText = fs.readFileSync(path.join(root, rel), 'utf-8');
      const pins = wfText.match(/GravionLabs\/ci\/node\/setup@\S+ # \S+/g) ?? [];
      expect(pins.length).toBeGreaterThan(0);
      for (const pin of pins) {
        expect(pin).toBe(
          'GravionLabs/ci/node/setup@6fea556f186018034aa4144a9aa3968b256f1579 # v1.5.0',
        );
      }
    },
  );
});
