# Telemetry

The dashboard is an OTLP receiver. Aspire sets `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES` on every project, JavaScript app and executable it starts. Containers are not instrumented by this.

## .NET: ServiceDefaults

Add a `*.ServiceDefaults` project (`dotnet new aspire-servicedefaults`) and call `builder.AddServiceDefaults()` in each service; it registers OpenTelemetry logging, metrics and tracing, health checks and service discovery. Reference it from every .NET project.

## Node (NestJS, Express)

```powershell
pnpm add @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
```

```ts
// instrumentation.ts, loaded first (node --import ./instrumentation.js)
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
new NodeSDK({ instrumentations: [getNodeAutoInstrumentations()] }).start();
```

`NodeSDK` reads `OTEL_EXPORTER_OTLP_*` from the environment: no endpoint in code.

## Rust

Crates `opentelemetry`, `opentelemetry_sdk`, `opentelemetry-otlp` (feature `grpc-tonic` or `http-proto`) and `tracing-opentelemetry`. The `opentelemetry-otlp` exporter builders read `OTEL_EXPORTER_OTLP_*` when no endpoint is set in code; build the span, log and metric exporters the same way.

## Gotchas

- Match the protocol: Aspire sets `OTEL_EXPORTER_OTLP_PROTOCOL` (`grpc` or `http/protobuf`); an exporter of the other kind fails silently
- Signal-specific variables win over the general one: `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`; with `http/protobuf` the general endpoint gets `/v1/traces` etc. appended, a signal-specific one is used as is
- A browser frontend does not get these variables; instrument it separately or skip it
- The local OTLP endpoint is plain HTTP; allow that in development only (`ASPIRE_ALLOW_UNSECURED_TRANSPORT=true`)
