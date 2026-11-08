import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/delivery/roadmap/scripts/New-Roadmap.ps1');

// #466: after a renumber the state has padded titles (M001) while ROADMAP.md still has unpadded keys (M1).
const state = {
  latestTag: 'v0.2.0',
  issues: [
    {
      number: 9,
      level: 'pbi',
      title: '[PBI] open work',
      size: 'S',
      labels: ['pbi'],
      parent: null,
      blockedBy: [],
      milestone: 'M003',
      url: null,
    },
  ],
  milestones: [
    {
      number: 1,
      title: 'M001 (0.2.0)',
      state: 'closed',
      open: 0,
      closed: 1,
      progress: 100,
      issues: [{ number: 7, title: '[PBI] done' }],
    },
    { number: 3, title: 'M003', state: 'open', open: 1, closed: 0, progress: 0, issues: [] },
  ],
};

const md = `# Roadmap

<!-- roadmap:begin done M1 -->
old done
<!-- roadmap:end -->

hand note one

<!-- roadmap:begin plan M3 -->
old plan
<!-- roadmap:end -->

hand note two

<!-- roadmap:slot plan -->
<!-- roadmap:slot done -->
`;

describe('New-Roadmap.ps1 renumbered keys', () => {
  it('rewrites M1/M3 blocks in place to M001/M003 without a second section', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-renum-'));
    const file = path.join(tmp, 'ROADMAP.md');
    fs.writeFileSync(file, md);
    const worker = new PwshWorker(script);
    try {
      const r = await worker.run(['-State', JSON.stringify(state), '-Path', file, '-Write'], {
        cwd: tmp,
      });
      expect(r.status).toBe(0);
      const out = fs.readFileSync(file, 'utf8');
      expect(out.match(/roadmap:begin done /g)).toHaveLength(1);
      expect(out.match(/roadmap:begin plan /g)).toHaveLength(1);
      expect(out).toContain('<!-- roadmap:begin done M001 -->');
      expect(out).toContain('<!-- roadmap:begin plan M003 -->');
      expect(out).not.toContain('old done');
      expect(out).not.toContain('old plan');
      const order = ['done M001', 'hand note one', 'plan M003', 'hand note two'].map((s) =>
        out.indexOf(s),
      );
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    } finally {
      await worker.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
