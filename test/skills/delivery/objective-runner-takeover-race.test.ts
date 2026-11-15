import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { marker } from '../../helpers/objective-loop';

// #593: a heartbeat PATCH of the old runner (`here`) that was in flight lands right after the forced takeover write of
// `there`. The first PATCH body is stored, then overwritten by the old marker; Enter-ObjectiveRunner must read back and rewrite.
const MODULE = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/ObjectiveRunner.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const GH = `#!/bin/bash
d="$FAKE_GH_DIR"
if [[ "$*" == *"-X PATCH"* ]]; then
  n=$(cat "$d/patches.txt" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$d/patches.txt"
  for a in "$@"; do [[ "$a" == body=* ]] && printf '%s' "\${a#body=}" > "$d/body.txt"; done
  if [[ -f "$d/late.txt" && ( $n -eq 1 || -f "$d/always.txt" ) ]]; then cp "$d/late.txt" "$d/body.txt"; fi
  echo '{"id":7}'; exit 0
fi
body=$(cat "$d/body.txt")
node -e 'console.log(JSON.stringify([[{id:7,body:process.argv[1]}]]))' "$body"
`;

describe.skipIf(!hasPwsh || process.platform === 'win32')('forced takeover race', () => {
  let dir = '';
  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'runner-race-')));
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin', 'gh'), GH, { mode: 0o755 });
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const takeover = (late: boolean, always = false) => {
    const d = fs.mkdtempSync(path.join(dir, 'case-'));
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    fs.writeFileSync(path.join(d, 'body.txt'), marker('here', now));
    if (late) fs.writeFileSync(path.join(d, 'late.txt'), marker('here', now));
    if (always) fs.writeFileSync(path.join(d, 'always.txt'), '');
    const r = spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-Command',
        `. '${MODULE}'; $r = Enter-ObjectiveRunner 'o/r' 1 'there' -Force; $r.Action`,
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
    return {
      out: r.stdout.trim(),
      body: fs.readFileSync(path.join(d, 'body.txt'), 'utf8'),
      patches: Number(fs.readFileSync(path.join(d, 'patches.txt'), 'utf8')),
    };
  };

  it('takes over with one write when nothing races', () => {
    const r = takeover(false);
    expect(r.out).toBe('took over');
    expect(r.body).toContain('host=there');
    expect(r.patches).toBe(1);
  });

  it('rewrites when a late heartbeat PATCH of the old runner overwrote the takeover', () => {
    const r = takeover(true);
    expect(r.out).toBe('took over');
    expect(r.body).toContain('host=there');
    expect(r.patches).toBe(2);
  });

  it('does not report took over when the marker is still foreign after two rewrites', () => {
    const r = takeover(true, true);
    expect(r.out).toBe('error');
    expect(r.patches).toBe(3);
  });
});
