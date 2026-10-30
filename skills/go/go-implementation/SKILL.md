---
name: go-implementation
description: 'Go implementation rules (gofmt, go vet, golangci-lint) extending `implementation`. Use when writing or changing Go code.'
---

## Framework

- **Build**: `go build ./...`
- **Static checks**: `go vet ./...` is mandatory; `golangci-lint run` when the project has a `.golangci.y*ml`
- **Module**: `go.mod` at the module root; `go mod tidy` after changing imports

## Package layout

- `cmd/<binary>/main.go`: thin entry point that wires dependencies and calls into `internal/`
- `internal/<pkg>/`: application code that must not be imported from outside the module
- `pkg/` only for code deliberately exported to other modules
- Package names: short, lowercase, singular, no underscores; no `util`/`common` packages
- Define interfaces in the consuming package, accept interfaces and return structs

## Errors

- Return `error` as the last value; never `panic` for expected failures
- Wrap with context: `fmt.Errorf("load config %q: %w", path, err)`
- Compare with `errors.Is`, extract with `errors.As`, never by `==` on wrapped errors or by string matching
- Sentinel errors as `var ErrNotFound = errors.New("not found")`; custom types for errors that carry data
- Handle an error once: return it or log it, not both
- Error strings are lowercase without trailing punctuation

## Context

- `ctx context.Context` is the first parameter of every function that does I/O, blocks or is cancellable
- Pass it down, never store it in a struct; derive with `context.WithTimeout`/`WithCancel` and `defer cancel()`
- Goroutines need a defined end (context, `errgroup`, `sync.WaitGroup`); no fire-and-forget

## Conventions

- Naming: `MixedCaps`, exported = capitalized; acronyms uppercase (`ID`, `URL`); receiver names short and consistent
- Make the zero value useful; avoid `init()` and mutable package-level state
- `defer` for cleanup (`Close`, `Unlock`) right after the acquire
- File naming: `snake_case.go`, tests `<name>_test.go`

## Format

- Extensions: `.go`
- Format: `gofmt -w {files}`
- Check (read-only): `gofmt -l {files}`
- Run after green tests, before the commit: `pwsh <implementation dir>/scripts/Format-Changed.ps1 -Language go` (`-Check` for the check commands; not-configured, override: references/format.md of `implementation`)

## Tests

Load `go-test` for table-driven tests, testify, parallelism, race detector and build tags.

## Review rules

- 🔴 Ignored error (`_ = f()` or unchecked return) on fallible calls; `panic` for expected failures
- 🔴 Data race: shared state written from goroutines without a mutex, channel or atomic
- 🔴 Hardcoded secrets; SQL built by string formatting
- 🟡 Error returned without context, wrapped with `%v` instead of `%w`, or compared with `==`/string matching instead of `errors.Is`/`errors.As`
- 🟡 Missing `ctx` on I/O functions, `context.Background()` inside request paths, `context` stored in a struct, missing `defer cancel()`
- 🟡 Goroutine without a stop condition; `defer` inside a loop that holds resources
- 🟡 `gofmt`, `go vet` or `golangci-lint` not clean; `//nolint` without a justifying comment
- 🟢 `util`/`common` packages, interfaces declared on the producer side, `init()` side effects
- 🟢 Tests follow `go-test`
