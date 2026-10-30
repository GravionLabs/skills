import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  extractInvokedSkills,
  analyzeTranscript,
  parseBaseline,
  baselineWarnings,
  main,
  summarize,
  checkThresholds,
  compareToBaseline,
  score,
  type RunRecord,
} from '../../scripts/skill-trigger-score.mjs';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const line = (o: unknown) => JSON.stringify(o);
const transcript = [
  line({ type: 'system', subtype: 'init', skills: ['review-fanout'] }),
  line({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'Let me load a skill.' }] },
  }),
  line({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'review-fanout' } }] },
  }),
  line({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
  }),
  'not json at all',
  line({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'delivery:verify-project' } }],
    },
  }),
  line({ type: 'result', result: 'done' }),
].join('\n');

const rec = (skill: string, kind: RunRecord['kind'], invoked: string[]): RunRecord => ({
  skill,
  kind,
  prompt: `${skill}-${kind}`,
  invoked,
});

describe('extractInvokedSkills', () => {
  it('returns Skill tool_use names in order, strips plugin prefix, ignores other tools and noise', () => {
    expect(extractInvokedSkills(transcript)).toEqual(['review-fanout', 'verify-project']);
  });

  it('returns an empty list for an empty transcript or one without skill calls', () => {
    expect(extractInvokedSkills('')).toEqual([]);
    expect(extractInvokedSkills(line({ type: 'result' }))).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    expect(extractInvokedSkills(transcript.split('\n').join('\r\n'))).toEqual([
      'review-fanout',
      'verify-project',
    ]);
  });

  it('ignores Skill blocks without a string skill name and non-array content', () => {
    const t = [
      line({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 5 } }] },
      }),
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill' }] } }),
      line({ type: 'assistant', message: { content: 'text' } }),
      line({ type: 'assistant', message: null }),
      '[1,2]',
    ].join('\n');
    expect(extractInvokedSkills(t)).toEqual([]);
  });

  it('keeps two Skill blocks of one message in order', () => {
    const t = line({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Skill', input: { skill: 'a' } },
          { type: 'tool_use', name: 'Skill', input: { skill: 'b' } },
        ],
      },
    });
    expect(extractInvokedSkills(t)).toEqual(['a', 'b']);
  });
});

describe('analyzeTranscript', () => {
  it('is completed and not failed with a successful result event', () => {
    expect(analyzeTranscript(transcript)).toMatchObject({ completed: true, failed: false });
  });

  it('fails on an empty transcript or one without a result event', () => {
    expect(analyzeTranscript('')).toEqual({ invoked: [], completed: false, failed: true });
    expect(analyzeTranscript(line({ type: 'system' }))).toMatchObject({
      completed: false,
      failed: true,
    });
  });

  it('fails on an error result but treats hitting max turns as a normal end', () => {
    expect(
      analyzeTranscript(line({ type: 'result', is_error: true, subtype: 'success' })).failed,
    ).toBe(true);
    expect(
      analyzeTranscript(line({ type: 'result', is_error: true, subtype: 'error_during_execution' }))
        .failed,
    ).toBe(true);
    expect(
      analyzeTranscript(line({ type: 'result', is_error: true, subtype: 'error_max_turns' }))
        .failed,
    ).toBe(false);
  });
});

describe('summarize', () => {
  const records = [
    rec('a', 'positive', ['a']),
    rec('a', 'positive', []),
    rec('a', 'negative', []),
    rec('a', 'negative', ['a']),
    rec('b', 'positive', ['b']),
    rec('b', 'negative', ['other']),
  ];

  it('computes per-skill trigger and false-trigger rates', () => {
    const s = summarize(records);
    expect(s.skills.find((k) => k.skill === 'a')).toMatchObject({
      triggerRate: 50,
      falseTriggerRate: 50,
    });
    expect(s.skills.find((k) => k.skill === 'b')).toMatchObject({
      triggerRate: 100,
      falseTriggerRate: 0,
    });
  });

  it('computes overall rates', () => {
    expect(summarize(records).overall).toEqual({
      positives: 3,
      negatives: 3,
      triggerRate: 66.7,
      falseTriggerRate: 33.3,
    });
  });

  it('handles no records', () => {
    expect(summarize([]).overall).toMatchObject({ triggerRate: 0, falseTriggerRate: 0 });
  });
});

describe('checkThresholds', () => {
  it('passes at exactly 80% / 10%', () => {
    const rs = [
      ...Array.from({ length: 5 }, (_, i) => rec('a', 'positive', i < 4 ? ['a'] : [])),
      ...Array.from({ length: 10 }, (_, i) => rec('a', 'negative', i < 1 ? ['a'] : [])),
    ];
    expect(checkThresholds(summarize(rs))).toEqual([]);
  });

  it('reports low trigger and high false-trigger rates', () => {
    const msgs = checkThresholds(
      summarize([rec('a', 'positive', []), rec('a', 'negative', ['a'])]),
    );
    expect(msgs).toContain('a: trigger rate 0% < 80%');
    expect(msgs).toContain('a: false-trigger rate 100% > 10%');
  });
});

describe('compareToBaseline', () => {
  const base = summarize([rec('a', 'positive', ['a']), rec('a', 'negative', [])]);

  it('reports no regression for identical results', () => {
    expect(compareToBaseline(base, base)).toEqual([]);
  });

  it('flags a drop greater than 5 points but not exactly 5', () => {
    const mk = (hits: number) =>
      summarize([
        ...Array.from({ length: 20 }, (_, i) => rec('a', 'positive', i < hits ? ['a'] : [])),
      ]);
    expect(compareToBaseline(mk(19), mk(20))).toEqual([]); // 95 vs 100 = 5 points
    expect(compareToBaseline(mk(18), mk(20))).toEqual([
      'overall: trigger rate fell 100% -> 90%',
      'a: trigger rate fell 100% -> 90%',
    ]);
  });

  it('flags a false-trigger rise and ignores skills absent from the baseline', () => {
    const cur = summarize([
      rec('a', 'positive', ['a']),
      rec('a', 'negative', ['a']),
      rec('new', 'positive', []),
    ]);
    const msgs = compareToBaseline(cur, base);
    expect(msgs).toContain('a: false-trigger rate rose 0% -> 100%');
    expect(msgs.some((m) => m.startsWith('new:'))).toBe(false);
  });
});

describe('compareToBaseline rounding and scope', () => {
  const sk = (
    skill: string,
    positives: number,
    triggerRate: number,
    falseTriggerRate = 0,
    negatives = 0,
  ) => ({
    skill,
    positives,
    negatives,
    triggerRate,
    falseTriggerRate,
  });
  const sum = (...skills: ReturnType<typeof sk>[]) => ({
    overall: { positives: 0, negatives: 0, triggerRate: 0, falseTriggerRate: 0 },
    skills,
  });

  it('does not flag a 5-point difference that only exceeds 5 through float noise', () => {
    expect(compareToBaseline(sum(sk('a', 6, 28.3)), sum(sk('a', 6, 33.3)))).toEqual([]);
  });

  it('flags a false-trigger rise greater than 5 but not exactly 5', () => {
    expect(compareToBaseline(sum(sk('a', 20, 100, 5, 20)), sum(sk('a', 20, 100, 0, 20)))).toEqual(
      [],
    );
    expect(
      compareToBaseline(sum(sk('a', 20, 100, 10, 20)), sum(sk('a', 20, 100, 0, 20))),
    ).toContain('a: false-trigger rate rose 0% -> 10%');
  });

  it('flags a per-skill drop that the overall rate hides', () => {
    const base = sum(sk('a', 10, 100), sk('b', 10, 0));
    const cur = sum(sk('a', 10, 80), sk('b', 10, 20));
    expect(compareToBaseline(cur, base)).toEqual(['a: trigger rate fell 100% -> 80%']);
  });

  it('compares overall over the skills both runs have, and ignores skills missing from the current run', () => {
    const base = sum(sk('a', 10, 100), sk('gone', 10, 0));
    const cur = sum(sk('a', 10, 100), sk('new', 10, 0));
    expect(compareToBaseline(cur, base)).toEqual([]);
  });

  it('compares nothing when no skill is shared', () => {
    expect(compareToBaseline(sum(sk('a', 1, 0)), sum(sk('b', 1, 100)))).toEqual([]);
  });
});

describe('score', () => {
  it('passes cleanly and passes records and context through', () => {
    const recs = [rec('a', 'positive', ['a']), rec('a', 'negative', [])];
    const r = score(recs, undefined, { meta: { model: 'sonnet', runs: 1 }, notInstalled: ['x'] });
    expect(r.thresholdFailures).toEqual([]);
    expect(r.regressions).toEqual([]);
    expect(r.records).toBe(recs);
    expect(r.meta).toEqual({ model: 'sonnet', runs: 1 });
    expect(r.notInstalled).toEqual(['x']);
    expect(r.sampleSize).toEqual({ prompts: 2, runs: 2, failed: 0 });
  });

  it('excludes failed runs from all rates', () => {
    const r = score([rec('a', 'positive', ['a']), { ...rec('a', 'positive', []), failed: true }]);
    expect(r.summary.overall.positives).toBe(1);
    expect(r.summary.overall.triggerRate).toBe(100);
    expect(r.failedRuns).toBe(1);
  });

  it('guards against zero positives', () => {
    const s = summarize([rec('a', 'negative', [])]);
    expect(s.overall.triggerRate).toBe(0);
    expect(checkThresholds(s)).toEqual([]);
  });

  it('accepts a result file as baseline and reports differing model and runs', () => {
    const base = score([rec('a', 'positive', ['a'])], undefined, {
      meta: { model: 'haiku', runs: 3 },
      notInstalled: ['x'],
    });
    const cur = score([rec('a', 'positive', ['a'])], base, {
      meta: { model: 'sonnet', runs: 1 },
      notInstalled: [],
    });
    expect(cur.warnings).toEqual([
      'baseline model haiku differs from sonnet',
      'baseline runs 3 differ from 1',
      'baseline notInstalled set differs (x vs none)',
    ]);
  });

  it('warns about baseline skills missing from the run', () => {
    const base = parseBaseline(score([rec('a', 'positive', ['a']), rec('b', 'positive', ['b'])]));
    expect(baselineWarnings({ summary: summarize([rec('a', 'positive', ['a'])]) }, base)).toEqual([
      'b is in the baseline but not in this run',
    ]);
  });

  it('combines thresholds and baseline regressions', () => {
    const base = summarize([rec('a', 'positive', ['a'])]);
    const r = score([rec('a', 'positive', [])], base);
    expect(r.thresholdFailures.length).toBeGreaterThan(0);
    expect(r.regressions).toContain('a: trigger rate fell 100% -> 0%');
  });

  it('has no regressions without a baseline', () => {
    expect(score([rec('a', 'positive', ['a'])]).regressions).toEqual([]);
  });
});

describe('parseBaseline', () => {
  const summary = summarize([rec('a', 'positive', ['a'])]);

  it('accepts a result file and a bare summary', () => {
    expect(parseBaseline({ summary, meta: { model: 'x' } }).summary).toEqual(summary);
    expect(parseBaseline(summary).summary).toEqual(summary);
  });

  it('rejects data without a usable summary', () => {
    expect(() => parseBaseline({ date: '2026-10-14' })).toThrow(/no usable summary/);
    expect(() => parseBaseline(null)).toThrow(/no usable summary/);
    expect(() => parseBaseline({ summary: { overall: {}, skills: [] } })).toThrow(
      /no usable summary/,
    );
  });
});

describe('main (CLI)', () => {
  function tmp(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'trigger-cli-'));
    tmpDirs.push(d);
    return d;
  }
  const write = (dir: string, name: string, data: unknown) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data));
    return f;
  };
  const silent = () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ];
    return () => spies.forEach((x) => x.mockRestore());
  };

  it('extract prints the analysis and exits 0', () => {
    const f = write(tmp(), 't.jsonl', transcript);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main(['extract', f])).toBe(0);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      invoked: ['review-fanout', 'verify-project'],
      completed: true,
      failed: false,
    });
    log.mockRestore();
  });

  it('score writes the result file and exits 0 when everything passes', () => {
    const d = tmp();
    const out = path.join(d, 'out.json');
    const restore = silent();
    const code = main([
      'score',
      write(d, 'r.json', [rec('a', 'positive', ['a']), rec('a', 'negative', [])]),
      out,
    ]);
    restore();
    expect(code).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).summary.overall.triggerRate).toBe(100);
  });

  it('score exits 1 on a threshold failure and on a regression against a committed-shape baseline', () => {
    const d = tmp();
    const base = write(
      d,
      'b.json',
      score([rec('a', 'positive', ['a'])], undefined, { meta: { model: 'sonnet', runs: 1 } }),
    );
    const restore = silent();
    const code = main([
      'score',
      write(d, 'r.json', [rec('a', 'positive', [])]),
      path.join(d, 'out.json'),
      base,
    ]);
    restore();
    expect(code).toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(d, 'out.json'), 'utf8')).regressions).toEqual([
      'overall: trigger rate fell 100% -> 0%',
      'a: trigger rate fell 100% -> 0%',
    ]);
  });

  it('score exits 2 for a baseline without a summary, malformed records, a missing file and unknown commands', () => {
    const d = tmp();
    const out = path.join(d, 'out.json');
    const good = write(d, 'r.json', [rec('a', 'positive', ['a'])]);
    const restore = silent();
    expect(main(['score', good, out, write(d, 'b.json', { overall: 1 })])).toBe(2);
    expect(main(['score', write(d, 'bad.json', [{ skill: 1 }]), out])).toBe(2);
    expect(main(['score', write(d, 'nojson.json', 'not json'), out])).toBe(2);
    expect(main(['score', path.join(d, 'missing.json'), out])).toBe(2);
    expect(main(['bogus'])).toBe(2);
    restore();
  });

  it('score exits 2 when more than 10% of the sessions failed but still writes the result', () => {
    const d = tmp();
    const out = path.join(d, 'out.json');
    const recs = [rec('a', 'positive', ['a']), { ...rec('a', 'negative', []), failed: true }];
    const restore = silent();
    const code = main(['score', write(d, 'r.json', recs), out]);
    restore();
    expect(code).toBe(2);
    expect(fs.existsSync(out)).toBe(true);
  });
});
