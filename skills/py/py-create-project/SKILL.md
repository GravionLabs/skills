---
name: py-create-project
description: 'Scaffold a new Python 3.14 project using uv with src layout, ruff, pytest, asyncio support, and a GitHub Actions CI workflow. Use when asked to create or scaffold a new Python project.'
disable-model-invocation: true
metadata:
  opencode/autoinvoke: 'false'
---

Scaffold a Python project with a production-ready baseline using `uv`. Paths to `scripts/` and `templates/` are relative to this skill's directory.

## Stack

- **uv** — package manager and environment tool (`uv init`, `uv add`, `uv sync`, `uv run`)
- **ruff** — linter + formatter (replaces flake8/black/isort)
- **pytest + pytest-asyncio** — testing with `asyncio_mode = "auto"`
- **Python 3.14** — current target version

## Steps

1. **Ask first:** project name; project type **library** (publishable package), **app** (application), or **workspace** (uv monorepo with `libs/` + `apps/`)
2. **Run the scaffold script:**

   ```powershell
   pwsh scripts/New-PythonProject.ps1 -ProjectName <Name> -ProjectType <library|app|workspace>
   ```

   It runs `uv init`, applies the template `pyproject.toml` (ruff + pytest config, registered test markers), creates `src/<package>/__init__.py` and `tests/conftest.py`, then runs `uv sync`.
3. **CI:** copy `templates/.github/workflows/ci.yml` into the project. It calls the `GravionLabs/ci` reusable Python workflow; if the project publishes, confirm the `PYPI_TOKEN` secret is configured.
4. **Verify:**

   ```powershell
   uv run ruff check .   # no lint errors
   uv run pytest         # tests pass
   uv build              # package builds (library/app)
   ```
5. **Next steps:** add dependencies with `uv add <package>`; uv flag reference in `py-implementation/references/uv-cli.md`

Parameters: `-ProjectName` (required), `-ProjectType` (library/app/workspace), `-OutputDirectory`, `-Upgrade` (resolve latest compatible versions)

## Templates

| File                       | Purpose                                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pyproject.toml`           | `uv_build` backend, `ruff` (line-length 120, Python 3.14), `pytest` (`asyncio_mode = "auto"`, `--strict-markers`, `unit`/`integration`/`manual` markers) |
| `src/__init__.py`          | Minimal package init                                                                                                                                     |
| `tests/conftest.py`        | Empty conftest                                                                                                                                           |
| `.python-version`          | Pins Python 3.14 for reproducible environments                                                                                                           |
| `.github/workflows/ci.yml` | GitHub Actions CI via `GravionLabs/ci/.github/workflows/python.yml`                                                                                      |
| `.gitignore`               | Python standard ignores (dist/, .venv/, **pycache**/)                                                                                                    |

## Constraints

- Always use `src/` layout — prevents accidental imports from the repo root
- Dev dependencies in `[dependency-groups] dev` (uv), not `optional-dependencies`
- Keep `asyncio_mode = "auto"` in the pytest config
- Commit `uv.lock` to version control
- CI: `uv run pytest` and `uv build` must work from a clean checkout

Report: summary, files created, verify commands.
