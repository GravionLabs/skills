// Host interface of the deliver loop (ADR 0005). The core knows GitHub, the stop rules and the events;
// a host knows where a harness session runs. Node built-ins only, erasable syntax only.

export type Harness = 'claude' | 'copilot';

export type SessionRequest = {
  harness: Harness;
  model: string;
  prompt: string;
  cwd: string;
  /** Extra variables for the session: AGENT_EVENTS_RUN, DELIVER_LOOP_DIR. The host adds the rest. */
  env: Record<string, string>;
};

/** What a host yields: raw output of the session. Parsing is the core's job (records.ts). */
export type RawRecord =
  | { kind: 'stdout'; line: string }
  | { kind: 'stderr'; text: string }
  | { kind: 'exit'; code: number };

export interface LoopHost {
  /** Starts one harness session and yields its output until it ends; the exit code is the last record. */
  runSession(req: SessionRequest): AsyncIterable<RawRecord>;
}
