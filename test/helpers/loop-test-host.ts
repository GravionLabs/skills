import type {
  LoopHost,
  RawRecord,
  SessionRequest,
} from '../../skills/delivery/deliver/scripts/loop/host.ts';

/** A host for loop tests: yields scripted records, starts no process. */
export class TestHost implements LoopHost {
  readonly requests: SessionRequest[] = [];
  private scripts: RawRecord[][];

  constructor(...scripts: RawRecord[][]) {
    this.scripts = scripts;
  }

  async *runSession(req: SessionRequest): AsyncGenerator<RawRecord> {
    this.requests.push(req);
    const script = this.scripts.shift() ?? [{ kind: 'exit', code: 0 }];
    yield* script;
  }
}

export function stdoutLines(text: string): RawRecord[] {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ kind: 'stdout' as const, line }));
}
