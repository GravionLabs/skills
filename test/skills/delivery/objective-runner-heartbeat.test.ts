import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { marker } from '../../helpers/objective-loop';

// #573: Invoke-RunnerBeat (ObjectiveRunner.ps1) against a bash fake gh whose single marker comment lives in a file. A
// `takeover -Force` of `there` lands right after the heartbeat's first read (the `interleave` file holds the foreign body).
const MODULE = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/ObjectiveRunner.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const GH = `#!/bin/bash
d="$FAKE_GH_DIR"
echo "$@" >> "$d/calls.txt"
if [[ "$*" == *"-X PATCH"* ]]; then
  for a in "$@"; do [[ "$a" == body=* ]] && printf '%s' "\${a#body=}" > "$d/body.txt"; done
  echo '{"id":7}'; exit 0
fi
n=$(cat "$d/gets.txt" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$d/gets.txt"
body=$(cat "$d/body.txt")
if [[ $n -eq 1 && -f "$d/interleave.txt" ]]; then cp "$d/interleave.txt" "$d/body.txt"; fi
node -e 'const b=process.argv[1]; console.log(JSON.stringify([[{id:7,body:b}]]))' "$body"
`;

describe.skipIf(!hasPwsh || process.platform === 'win32')('Invoke-RunnerBeat', () => {
  let dir = '';
  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'runner-beat-')));
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin', 'gh'), GH, { mode: 0o755 });
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const beat = (interleaved: boolean) => {
    const d = fs.mkdtempSync(path.join(dir, 'case-'));
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    fs.writeFileSync(path.join(d, 'body.txt'), marker('here', now));
    if (interleaved) fs.writeFileSync(path.join(d, 'interleave.txt'), marker('there', now));
    const r = spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-Command',
        `. '${MODULE}'; $sh = @{ Foreign = $null; Checkout = @() }; $r = Invoke-RunnerBeat 'o/r' 1 'here' '${now}' $sh; "$r|$($sh.Foreign)"`,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
          FAKE_GH_DIR: d,
        },
      },
    );
    const calls = fs.readFileSync(path.join(d, 'calls.txt'), 'utf8');
    return {
      out: r.stdout.trim(),
      patched: calls.includes('-X PATCH'),
      body: fs.readFileSync(path.join(d, 'body.txt'), 'utf8'),
    };
  };

  it('refreshes an own marker', () => {
    const r = beat(false);
    expect(r.out).toBe('False|');
    expect(r.patched).toBe(true);
    expect(r.body).toContain('host=here');
  });

  it('a takeover -Force landing after the first read wins: no PATCH, the runner hands over', () => {
    const r = beat(true);
    expect(r.out).toBe('True|there');
    expect(r.patched).toBe(false);
    expect(r.body).toContain('host=there');
  });
});
