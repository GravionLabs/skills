# Resources

Examples for `apphost.cs` (Aspire 13.6.x). Packages: `#:package Aspire.Hosting.PostgreSQL@13.6.0` and so on.

## Parameters and secrets

No passwords in code or committed config.

```csharp
var builder = DistributedApplication.CreateBuilder(args);
var pgPassword = builder.AddParameter("pg-password", secret: true);
```

Values come from user secrets or the environment (`Parameters__pg-password`).

## Postgres

```csharp
var pg = builder.AddPostgres("pg", password: pgPassword)
    .WithDataVolume()
    .WithLifetime(ContainerLifetime.Persistent);
var db = pg.AddDatabase("appdb");
```

Postgres 18 images keep data in `/var/lib/postgresql` (a version-specific subdirectory), not `/var/lib/postgresql/data`. With `.WithImageTag("18")` mount explicitly: `.WithVolume("pg-data", "/var/lib/postgresql")` instead of `WithDataVolume()`.

## Valkey / Redis

```csharp
var cache = builder.AddValkey("cache").WithDataVolume();   // Aspire.Hosting.Valkey
// builder.AddRedis("cache") for Redis (Aspire.Hosting.Redis)
```

## Keycloak (preview package Aspire.Hosting.Keycloak)

```csharp
var keycloak = builder.AddKeycloak("keycloak", port: 8080)   // fixed port: the issuer URL must stay stable
    .WithRealmImport("./realms")                             // *.json realm files
    .WithDataVolume();
```

Token issuer, redirect URIs and the frontend's authority refer to `http://localhost:8080`; a random port would break them.

## Generic containers

```csharp
var store = builder.AddContainer("rustfs", "rustfs/rustfs", "1.0.0")
    .WithHttpEndpoint(port: 9000, targetPort: 9000, name: "s3")
    .WithVolume("rustfs-data", "/data")
    .WithEnvironment("RUSTFS_ACCESS_KEY", accessKey);   // a parameter, not a literal
```

Consumers use `WithReference(store.GetEndpoint("s3"))`.

## Projects, JavaScript apps, executables

```csharp
var api = builder.AddProject<Projects.Api>("api")           // #:project ../src/Api/Api.csproj
    .WithReference(db).WaitFor(db)
    .WithReference(cache).WaitFor(cache);

var web = builder.AddViteApp("web", "../web")               // Aspire.Hosting.JavaScript
    .WithReference(api).WaitFor(api);
var nest = builder.AddJavaScriptApp("backend", "../backend", "start:dev")
    .WithHttpEndpoint(env: "PORT")
    .WithReference(db).WaitFor(db);

var worker = builder.AddExecutable("worker", "cargo", "../worker", "run")
    .WithReference(db).WaitFor(db);

builder.Build().Run();
```

## References

- `WithReference(x)` injects the connection string or service URL as environment variables (`ConnectionStrings__appdb`, `services__api__http__0`); the consumer reads them from configuration
- `WaitFor(x)` delays the start until `x` is healthy; use it for every dependency that must be up at start
- Non-.NET consumers read the injected variables directly; map them in the app's config loader instead of hard-coding hosts
