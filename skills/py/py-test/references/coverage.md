# Coverage with pytest-cov

Install: `uv add --dev pytest-cov`

## Commands

```powershell
# Gap analysis
uv run --frozen pytest --cov=<source-dir> --cov-report=term-missing

# HTML report for browser review (writes htmlcov/)
uv run --frozen pytest --cov=<source-dir> --cov-report=term-missing --cov-report=html

# Enforce a threshold
uv run --frozen pytest --cov=<source-dir> --cov-report=term-missing --cov-fail-under=<target>

# CI: Cobertura XML
uv run --locked pytest --cov=<source-dir> --cov-report=xml --cov-report=term
```

## Gotchas

- Choose `--cov-fail-under` from the project's target — default to 80 if unspecified
- `--cov-report=html` is optional; omit it when only gap analysis is needed
- Test naming stays `test_<condition>_<expected>` (see `marks-and-naming.md`)
- `--frozen` vs `--locked` vs `--no-sync`: see `py-implementation/references/uv-cli.md`
