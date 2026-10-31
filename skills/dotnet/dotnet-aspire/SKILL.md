---
name: dotnet-aspire
description: 'Make a repository Aspire-capable for local development: AppHost, resources, references and dashboard telemetry, also for polyglot repos. Use for "add Aspire", "Aspire AppHost", "make this repo Aspire-capable".'
---

Aspire 13 starts the processes and infrastructure of a repository for local development and wires connection strings and URLs as environment variables. Paths to `references/` are relative to this skill's directory.

## When it fits

- Fits: several processes or infrastructure (database, cache, identity provider, frontend, API) started together for local development, also when only part of the stack is .NET
- Does not fit: a single Tauri or desktop app with an in-process backend, a single-project console app or library; say so and stop
- Out of scope: `aspire publish`, `aspire deploy`, Azure Container Apps, Kubernetes manifests, changing an existing compose or Helm setup

## Steps

1. Check .NET 10 (`dotnet --version`) and the `aspire` CLI (`aspire --version`); missing → tell the user, do not install silently.
2. Choose the form:
   - File-based `apphost.cs` (default for a repository that is not mainly .NET): first lines `#:sdk Aspire.AppHost.Sdk@13.6.0`, `#:package` per integration, `#:project` per .NET project; run with `aspire run`
   - AppHost project (`<Project Sdk="Aspire.AppHost.Sdk/13.6.0">`, `*.AppHost.csproj`): when the repository already has a solution with Central Package Management; add it to the solution and put package versions in `Directory.Packages.props`
3. Inventory what runs locally (existing compose file, scripts, `package.json`, `Cargo.toml`, projects) and model each as a resource: `references/resources.md`.
4. Connect them with `WithReference` and `WaitFor`; secrets as parameters, never in code.
5. Add telemetry so the dashboard shows traces, logs and metrics: `references/telemetry.md`.
6. If a compose or Helm setup exists: read `references/coexistence.md` before touching anything.
7. Verify with `aspire run`; the dashboard lists every resource as running or healthy.

## Gotchas

- `#:sdk`, `#:package` and `#:project` directives need .NET 10
- Pin the Aspire version in the SDK directive and every `Aspire.Hosting.*` package to the same stable release (13.6.x); `Aspire.Hosting.Keycloak` is preview
- Fixed host ports only where something outside Aspire depends on them (issuer URL, redirect URIs); otherwise let Aspire assign ports
- One AppHost per repository; do not duplicate service definitions that compose keeps for demo and CI

Report: form chosen, resources added, how to start it (`aspire run`), open decisions.
