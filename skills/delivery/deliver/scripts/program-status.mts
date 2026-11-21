// OSC 7501 (Program Status Protocol): the loop tells the terminal it runs in whether it works, waits for
// the owner, is done or failed (ADR 0007). The sequence goes straight to the controlling terminal because
// an agent harness captures stdout. No terminal, or DELIVER_PROGRAM_STATUS=0: nothing is written.
// Writing never fails the caller.
import { openSync, writeSync } from 'node:fs';

export type State = 'idle' | 'working' | 'blocked' | 'done' | 'error' | 'clear';
export type Kind = 'permission' | 'question' | 'auth';
export type Report = { state: State; title?: string; msg?: string; kind?: Kind; progress?: number };

const MAX_TITLE = 192;
const MAX_MSG = 2048;
export const APP = 'deliver';

/** Control characters, bidi overrides/isolates and zero-width characters become spaces; whitespace collapses. */
function clean(text: string): string {
  return text
    .replace(/[\p{Cc}​-‏‪-‮⁠-⁩﻿]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cuts at a character boundary so that the UTF-8 bytes stay within `max`. */
function limit(text: string, max: number): string {
  let out = '';
  let bytes = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char);
    if (bytes + size > max) break;
    out += char;
    bytes += size;
  }
  return out;
}

const b64 = (text: string, max: number): string =>
  Buffer.from(limit(clean(text), max), 'utf8').toString('base64');

/** The escape sequence of one report; `kind` is only kept with `blocked`. */
export function encodeStatus(report: Report): string {
  const pairs = [`state=${report.state}`, `app=${APP}`];
  if (report.title) pairs.push(`title=${b64(report.title, MAX_TITLE)}`);
  if (report.msg) pairs.push(`msg=${b64(report.msg, MAX_MSG)}`);
  if (report.progress !== undefined && Number.isInteger(report.progress)) {
    pairs.push(`progress=${Math.min(100, Math.max(0, report.progress))}`);
  }
  if (report.state === 'blocked' && report.kind) pairs.push(`kind=${report.kind}`);
  return `\x1b]7501;${pairs.join(':')}\x1b\\`;
}

export type Writer = (data: string) => void;

/** Opens the controlling terminal: /dev/tty on Unix, CONOUT$ on Windows. Undefined without one. */
export function openTerminal(platform: string = process.platform): Writer | undefined {
  try {
    const fd = openSync(platform === 'win32' ? '\\\\.\\CONOUT$' : '/dev/tty', 'w');
    return (data) => {
      try {
        writeSync(fd, data);
      } catch {
        // a display must not stop a delivery
      }
    };
  } catch {
    return undefined;
  }
}

/** Half of the 10 minutes after which a terminal without a signal counts as silent. */
export const HEARTBEAT_SECONDS = 300;

/**
 * The descriptor stays open for the life of the loop. While the state is `working` or `blocked` the last
 * report is repeated every `DELIVER_HEARTBEAT_SECONDS` (default 300) so a long task is not mistaken for a
 * silent terminal. The timer is unref'ed; any other state stops it.
 */
export function programStatus(
  env: NodeJS.ProcessEnv = process.env,
  open: () => Writer | undefined = openTerminal,
): (report: Report) => void {
  if (env.DELIVER_PROGRAM_STATUS === '0') return () => {};
  const write = open();
  if (!write) return () => {};
  const seconds = Number(env.DELIVER_HEARTBEAT_SECONDS);
  const interval = (Number.isFinite(seconds) && seconds > 0 ? seconds : HEARTBEAT_SECONDS) * 1000;
  let timer: ReturnType<typeof setInterval> | undefined;
  return (report) => {
    const sequence = encodeStatus(report);
    write(sequence);
    if (timer) clearInterval(timer);
    timer = undefined;
    if (report.state === 'working' || report.state === 'blocked') {
      timer = setInterval(() => write(sequence), interval);
      timer.unref();
    }
  };
}
