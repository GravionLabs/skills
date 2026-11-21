# Clippy lint set

All Rust repositories share one lint set in `[workspace.lints]`. Copy `templates/workspace-lints.toml` into the root `Cargo.toml`; each member crate opts in with `[lints]` and `workspace = true`. Keep the repository's own `[workspace.lints.rust]` entries (`unsafe_code = "forbid"`).

## The set

- `pedantic` as `warn` with `priority = -1`, so single lints below can override it
- `unwrap_used`, `expect_used`, `panic`: no panics on fallible paths; return `Result` instead
- `allow_attributes`, `allow_attributes_without_reason`: no `#[allow]`; every suppression is an `#[expect]` with a reason

The gate turns every warning into an error: `cargo clippy --all-targets --all-features -- -D warnings`.

## Suppressing a lint

Use `#[expect(lint, reason = "…")]`, never `#[allow]`:

```rust
#[expect(clippy::cast_possible_truncation, reason = "length is checked above")]
let small = len as u8;
```

- The `reason` is required
- An `expect` that is no longer met warns as `unfulfilled_lint_expectations`: remove it
- Scope it to the smallest item

## clippy.toml

`templates/clippy.toml` goes next to the `Cargo.toml` of the workspace (or of the crate, as `src-tauri/clippy.toml` in a Tauri app). It allows `unwrap`, `expect`, `panic` and indexing in tests only, and holds a commented `disallowed-methods` / `disallowed-types` example.
