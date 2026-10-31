# Coexistence with compose and Helm

Aspire is the local development topology. It does not replace the others.

- Compose stays for demo and CI; Helm stays for cluster deployment. Do not change either in this task
- Reuse the same images, tags and environment names as compose, so a service behaves the same in both
- Same host ports as compose for the same service (Postgres 5432, Keycloak 8080, ...): app config and issuer URLs then work under both. Compose and Aspire must not run at the same time; say so in the README
- No third topology to keep in step: do not copy service definitions into a new format. Share values (image tags, realm files, init SQL) from one place both consume, for example a `docker/` folder that compose mounts and the AppHost references
- The AppHost models only what a developer needs locally (infrastructure plus the apps under development); demo-only services stay in compose

## ADR

Write an ADR (the repository's ADR folder, else a new ADR folder) when the AppHost becomes the documented way to start the stack, when it adds a .NET 10 requirement to a repository that had none, or when it deliberately deviates from compose (ports, images, volumes). Keep it short: context, decision (Aspire for local, compose for demo and CI), consequences.
