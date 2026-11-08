import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { AGENT_EVENTS_DIR, AGENT_EVENTS_TAG } from '../../helpers/agent-events';

// ADR 0003: the progress event schemas and the event/state fixtures live in GravionLabs/agent-events. The directory
// test/skills/delivery/agent-events/ is a copy of the tag in its VERSION file. To bump the pin: write the new tag to
// VERSION and refresh the copy with
//   gh api repos/GravionLabs/agent-events/contents/<path>?ref=<tag> -H 'Accept: application/vnd.github.raw'
// for every file below schema/ and fixtures/. AGENT_EVENTS_VERIFY=1 makes the comparison with the tag mandatory (CI);
// otherwise it is skipped when gh or the network is unavailable, so the suite does not hang offline.
const REPO = 'GravionLabs/agent-events';
const ROOT = path.resolve(__dirname, '../../..');

const listLocal = (sub: string) => fs.readdirSync(path.join(AGENT_EVENTS_DIR, sub)).sort();
const gh = (args: string[]) =>
  spawnSync('gh', ['api', ...args], { encoding: 'utf8', timeout: 15000, maxBuffer: 16 << 20 });

const must = process.env.AGENT_EVENTS_VERIFY === '1';
const online = (() => {
  if (spawnSync('gh', ['--version']).status !== 0) return false;
  return gh([`repos/${REPO}/git/ref/tags/${AGENT_EVENTS_TAG}`, '--jq', '.ref']).status === 0;
})();

describe('agent-events pin (#452)', () => {
  it('records the tag in one place, a v1 release', () => {
    expect(AGENT_EVENTS_TAG).toMatch(/^v1\.\d+\.\d+$/);
    expect(
      fs.readFileSync(path.join(AGENT_EVENTS_DIR, 'VERSION'), 'utf8').trim().split('\n'),
    ).toHaveLength(1);
  });

  it('the schemas and event fixtures of skills are gone: they are not edited here any more', () => {
    for (const f of ['progress-event.schema.json', 'deliver-run-state.schema.json']) {
      expect(fs.existsSync(path.join(ROOT, 'skills/delivery/deliver/schema', f)), f).toBe(false);
    }
    const dups = fs
      .readdirSync(path.join(__dirname, 'fixtures/progress-events'))
      .filter((f) => /\.(jsonl|state\.json)$/.test(f));
    expect(dups).toEqual([]);
  });

  it('every event fixture has a state fixture', () => {
    const jsonl = listLocal('fixtures').filter((f) => f.endsWith('.jsonl'));
    const states = listLocal('fixtures').filter((f) => f.endsWith('.state.json'));
    expect(jsonl.map((f) => f.replace(/\.jsonl$/, ''))).toEqual(
      states.map((f) => f.replace(/\.state\.json$/, '')),
    );
  });

  it.skipIf(!online && !must)(
    'the copy equals the tag in GravionLabs/agent-events (offline: skipped; AGENT_EVENTS_VERIFY=1 fails instead)',
    () => {
      expect(online, `cannot reach ${REPO}@${AGENT_EVENTS_TAG} with gh api`).toBe(true);
      for (const sub of ['schema', 'fixtures']) {
        const r = gh([`repos/${REPO}/contents/${sub}?ref=${AGENT_EVENTS_TAG}`, '--jq', '.[].name']);
        expect(r.status, r.stderr).toBe(0);
        const remote = r.stdout.split('\n').filter(Boolean).sort();
        expect(listLocal(sub), `${sub}/ file list`).toEqual(remote);
        for (const name of remote) {
          const f = gh([
            `repos/${REPO}/contents/${sub}/${name}?ref=${AGENT_EVENTS_TAG}`,
            '-H',
            'Accept: application/vnd.github.raw',
          ]);
          expect(f.status, f.stderr).toBe(0);
          expect(
            fs.readFileSync(path.join(AGENT_EVENTS_DIR, sub, name), 'utf8'),
            `${sub}/${name}`,
          ).toBe(f.stdout);
        }
      }
    },
    60000,
  );
});
