---
name: go-test
description: >
  Go test rules using go test (table-driven tests, testify, t.Parallel, race detector,
  build-tag integration tests). Use when writing or running tests in a Go project.
---

## Prerequisites

- Go toolchain matching the `go` directive in `go.mod`
- Project root with `go.mod`

## Test Runner

- **Framework**: standard `testing` package; `testify` (`assert`/`require`) optional, only if already in `go.mod`
- **Run all**: `go test ./...`
- **Targeted run** (per commit): `go test ./path/to/pkg -run '^TestName$'` for the packages of the changed code; unknown mapping: `go test -short ./...`
- **Race detector**: `go test -race ./...` (before the pull request and in CI)
- **Coverage**: `go test -cover ./...` or `go test -coverprofile=cover.out ./... && go tool cover -func=cover.out`
- Disable caching when needed: `-count=1`

### File Naming

- `<name>_test.go` next to the code; `package foo` for white-box, `package foo_test` for public-API tests
- Test functions `TestXxx(t *testing.T)`, name `Test<Func>` with subtests per condition

## Writing Tests

- Table-driven: a slice of `{name, input, want, wantErr}` cases and `t.Run(tc.name, ...)`
- `t.Parallel()` in tests and subtests without shared mutable state; with Go < 1.22 copy the loop variable (`tc := tc`)
- `t.Helper()` in helpers, `t.Cleanup` and `t.TempDir()` for resources, `t.Setenv` for environment
- Compare errors with `errors.Is`/`errors.As` (or `require.ErrorIs`); with testify use `require` for preconditions, `assert` for checks
- Integration tests (DB, HTTP, containers) behind a build tag: first line `//go:build integration`, run with `go test -tags=integration ./...`
- Fakes through small interfaces defined by the consumer; `net/http/httptest` for HTTP

## Gotchas

- `t.Parallel()` with `t.Setenv` panics; do not combine them
- Never call `t.Fatal` in a spawned goroutine; collect results and assert in the test goroutine
- Never write tests that pass trivially without exercising logic
- Do not test unexported internals when the exported API covers the behavior

## Review rules

- 🟡 A test that simulates a missing tool sets `PATH` to a directory that holds only the tools the test needs (`t.Setenv("PATH", dir)` with `dir` from `t.TempDir()`), never system paths such as `/usr/bin:/bin`: the tool may exist on the CI image and the test turns red there
