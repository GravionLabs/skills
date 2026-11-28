# /deliver-triage

Judges one attention case of a `deliver` run and writes a result file with one allowed action. It changes nothing else.

## Usage

`/deliver-triage --case <file> --result <file>`

## Arguments and flags

| Flag              | Meaning                                               |
| :---------------- | :---------------------------------------------------- |
| `--case <file>`   | The attention case to judge                           |
| `--result <file>` | Where the result is written (`references/actions.md`) |
| `help`            | Print this help                                       |

## Examples

- `/deliver-triage --case /tmp/case.json --result /tmp/result.json`
- `/deliver-triage help`

## Config

none

## See also

`deliver`, `deliver-review`, [ADR 0011](https://github.com/GravionLabs/skills/blob/main/docs/adr/0011-objective-runs-in-three-layers-loop-code-deliver-triage-poimen-as-host.md)
