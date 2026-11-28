import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EXIT,
  type ResultWord,
  readResult,
  runGate,
} from '../../../skills/delivery/deliver/scripts/gates/result.mts';

const skill = path.resolve(__dirname, '../../../skills/delivery/deliver');
const module = pathToFileURL(path.join(skill, 'scripts/gates/result.mts')).href;
const words = Object.keys(EXIT) as ResultWord[];

let dir: string;
let gate: string;

// one gate script whose first argument picks the behavior
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'gate-result-'));
  gate = path.join(dir, 'gate.mts');
  writeFileSync(
    gate,
    `import { parseArgs } from 'node:util';
import { emit, gateMain, UsageError } from ${JSON.stringify(module)};
const [mode, word] = process.argv.slice(2);
const result = { result: word, reason: 'because', evidence: { pr: 7 } };
if (mode === 'emit') emit(result);
else if (mode === 'silent') { console.error('boom'); process.exitCode = 3; }
else await gateMain(async ([mode]) => {
  if (mode === 'usage') throw new UsageError('give a pull request\\nsecond line');
  if (mode === 'args') parseArgs({ args: ['--nope'], options: {} });
  if (mode === 'throw') throw new Error('gh failed');
  return result;
});
`,
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('emit', () => {
  it.each(words)('prints one JSON line and exits with the code of %s', async (word) => {
    // runGate reads `pass` back only when the line and the exit code agree
    await expect(runGate(gate, ['emit', word])).resolves.toEqual({
      result: word,
      reason: 'because',
      evidence: { pr: 7 },
    });
  });

  it('maps the words to the exit codes of ADR 0012', () => {
    expect(EXIT).toEqual({ pass: 0, fail: 1, usage: 64, retry: 75, owner: 77 });
  });
});

describe('readResult', () => {
  const json = (value: Record<string, unknown>) =>
    JSON.stringify({ result: 'pass', reason: '', evidence: {}, ...value });

  it('reads a valid result', () => {
    expect(readResult(`${json({})}\n`, 0)).toEqual({ result: 'pass', reason: '', evidence: {} });
  });

  it.each([
    ['no output', '', 0, /no output/],
    ['text that is no JSON', 'ok', 0, /not one JSON object/],
    ['two lines', `${json({})}\n${json({})}`, 0, /not one JSON object/],
    ['a JSON array', '[]', 0, /not one JSON object/],
    ['an unknown word', json({ result: 'maybe' }), 0, /unknown result word "maybe"/],
    ['an inherited key as word', json({ result: 'toString' }), 0, /unknown result word/],
    ['a missing reason', json({ reason: undefined }), 0, /reason/],
    ['evidence that is no object', json({ evidence: [] }), 0, /evidence/],
    ['pass with exit 1', json({}), 1, /result pass needs exit 0, got 1/],
    ['a killed script', json({}), null, /got null/],
  ])('fails on %s', (_name, stdout, code, reason) => {
    const result = readResult(stdout, code);
    expect(result.result).toBe('fail');
    expect(result.reason).toMatch(reason);
  });
});

describe('gateMain', () => {
  it.each([
    ['usage', 'usage', 'give a pull request'],
    ['args', 'usage', "Unknown option '--nope'"],
    ['throw', 'fail', 'gh failed'],
  ])('turns the error of mode %s into %s', async (mode, word, reason) => {
    const result = await runGate(gate, [mode]);
    expect(result).toMatchObject({ result: word, evidence: {} });
    expect(result.reason).toContain(reason);
    expect(result.reason).not.toContain('\n');
  });

  it('emits the returned result', async () => {
    await expect(runGate(gate, ['return', 'owner'])).resolves.toEqual({
      result: 'owner',
      reason: 'because',
      evidence: { pr: 7 },
    });
  });
});

describe('runGate', () => {
  it('keeps the error output of a script without a result', async () => {
    const result = await runGate(gate, ['silent']);
    expect(result.result).toBe('fail');
    expect(result.evidence).toMatchObject({ exitCode: 3, stderr: 'boom\n' });
  });
});

describe('references/gates.md', () => {
  it('lists every result word with its exit code', () => {
    const text = readFileSync(path.join(skill, 'references/gates.md'), 'utf8');
    for (const word of words)
      expect(text).toMatch(new RegExp(`\\| \`${word}\` +\\| ${EXIT[word]} `));
  });

  it('is linked from SKILL.md', () => {
    expect(readFileSync(path.join(skill, 'SKILL.md'), 'utf8')).toContain('(references/gates.md)');
  });
});
