// Record parsers of the deliver loop core: Claude Code (stream-json) and Copilot CLI (--output-format json).
import type { Harness, RawRecord } from './host.ts';

export type SessionRecord =
  | { kind: 'tool'; prefix: string; name: string; what: string }
  | { kind: 'text'; prefix: string; text: string }
  | { kind: 'progress'; prefix: string; issue: number; step: string; result: string }
  | { kind: 'tool-error'; prefix: string; text: string }
  | { kind: 'unparsed'; text: string }
  | { kind: 'stderr'; text: string; ceilingStop?: string }
  | { kind: 'exit'; code: number };

type Json = Record<string, any>;

const LINE_WIDTH = 120;
const CEILING_STDERR = /Background tasks still running .* stopping them/;
const PROGRESS_LINE = /^#(\d+) ([^:\n]+?)(?:: (.*))?$/;

/** First non-blank line, cut to n characters with an ellipsis (Get-Short). */
export function short(s: string, n = LINE_WIDTH): string {
  const first = String(s ?? '')
    .split(/\r?\n/)
    .find((l) => l.trim());
  if (!first) return '';
  return first.length > n ? `${first.slice(0, n)}…` : first;
}

/** A `#<nr> <step>: <result>` progress line of deliver, or null. */
export function parseProgressLine(text: string): { issue: number; step: string; result: string } | null {
  const m = PROGRESS_LINE.exec(text.trim());
  return m ? { issue: Number(m[1]), step: m[2], result: m[3] ?? '' } : null;
}

function toolWhat(input: Json | undefined): string {
  for (const k of ['description', 'file_path', 'command', 'pattern', 'path']) {
    if (input?.[k]) return short(String(input[k]));
  }
  return '';
}

function textRecords(prefix: string, text: string): SessionRecord[] {
  const progress = parseProgressLine(text);
  return progress ? [{ kind: 'progress', prefix, ...progress }] : [{ kind: 'text', prefix, text: short(text) }];
}

/** One parser per session: it remembers the names of subagents. */
export class RecordParser {
  private agentNames = new Map<string, string>();
  private harness: Harness;
  private ceilingStop: string;

  /** ceilingStop: the `VAR=value` text reported when the harness stops background tasks at the wait ceiling. */
  constructor(harness: Harness, ceilingStop = '') {
    this.harness = harness;
    this.ceilingStop = ceilingStop;
  }

  parse(raw: RawRecord): SessionRecord[] {
    if (raw.kind === 'exit') return [{ kind: 'exit', code: raw.code }];
    if (raw.kind === 'stderr') {
      const text = short(raw.text);
      return [CEILING_STDERR.test(raw.text) ? { kind: 'stderr', text, ceilingStop: this.ceilingStop } : { kind: 'stderr', text }];
    }
    if (!raw.line.trim()) return [];
    let rec: Json;
    try {
      rec = JSON.parse(raw.line);
    } catch {
      return [{ kind: 'unparsed', text: short(raw.line) }];
    }
    if (rec === null || typeof rec !== 'object') return [{ kind: 'unparsed', text: short(raw.line) }];
    return this.harness === 'copilot' ? this.copilot(rec) : this.claude(rec);
  }

  private prefix(parent: unknown): string {
    if (typeof parent !== 'string' || !parent) return '';
    const name = this.agentNames.get(parent);
    return name ? `[${name}] ` : '[subagent] ';
  }

  private claude(rec: Json): SessionRecord[] {
    const prefix = this.prefix(rec.parent_tool_use_id);
    const content = Array.isArray(rec.message?.content) ? rec.message.content : [];
    const out: SessionRecord[] = [];
    for (const c of content) {
      if (!c) continue;
      if (rec.type === 'assistant' && c.type === 'tool_use') {
        if (c.name === 'Agent' || c.name === 'Task') this.agentNames.set(c.id, short(String(c.input?.description ?? ''), 60));
        out.push({ kind: 'tool', prefix, name: c.name, what: toolWhat(c.input) });
      } else if (rec.type === 'assistant' && c.type === 'text') {
        out.push(...textRecords(prefix, String(c.text ?? '')));
      } else if (rec.type === 'user' && c.type === 'tool_result' && c.is_error) {
        const body = typeof c.content === 'string' ? c.content : (c.content ?? []).map((x: Json) => x.text).join('\n');
        out.push({ kind: 'tool-error', prefix, text: short(body) });
      }
    }
    return out;
  }

  private copilot(rec: Json): SessionRecord[] {
    const d: Json = rec.data ?? {};
    const prefix = this.prefix(d.parentToolCallId);
    switch (rec.type) {
      case 'subagent.started':
        if (d.toolCallId) this.agentNames.set(d.toolCallId, short(String(d.agentDisplayName ?? d.agentName ?? ''), 60));
        return [];
      case 'tool.execution_start':
        return [{ kind: 'tool', prefix, name: String(d.toolName ?? ''), what: toolWhat(d.arguments) }];
      case 'assistant.message':
        return d.content ? textRecords(prefix, String(d.content)) : [];
      case 'tool.execution_complete': {
        if (d.success !== false) return [];
        const body = d.error?.message ? String(d.error.message) : d.result?.content ? String(d.result.content) : 'tool failed';
        return [{ kind: 'tool-error', prefix, text: short(body) }];
      }
      default:
        return [];
    }
  }
}

/** Parses the raw output of a host. `ceilingStop` is the `VAR=value` text of a ceiling stop. */
export async function* parseSession(harness: Harness, raw: AsyncIterable<RawRecord>, ceilingStop = ''): AsyncGenerator<SessionRecord> {
  const parser = new RecordParser(harness, ceilingStop);
  for await (const r of raw) yield* parser.parse(r);
}
