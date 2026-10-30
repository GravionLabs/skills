# Directory structure, marks, naming

## Directory

```
tests/
├── conftest.py
├── unit/
│   ├── conftest.py
│   └── test_<module>.py
├── integration/
│   ├── conftest.py
│   └── test_<module>.py
└── manual/
    └── test_<module>.py
```

Mirror the `src/` layout.

## Marks

Every test gets exactly one type mark:

```python
@pytest.mark.unit
def test_valid_order_returns_total(): ...

@pytest.mark.integration
def test_order_service_saves_to_db(): ...

@pytest.mark.manual
def test_payment_gateway_live(): ...
```

The `unit`, `integration` and `manual` markers are registered in `pyproject.toml` by the `py-create-project` template (`--strict-markers`, `manual` skipped by default). In a project that was not scaffolded with it, register them under `[tool.pytest.ini_options] markers` before use.

## Naming

Scenario directly as `test_<condition>_<expected>`:

```python
def test_valid_id_returns_user(): ...
def test_null_id_raises_exception(): ...
def test_empty_input_returns_empty_list(): ...
```

**Parametrize** with meaningful IDs:

```python
@pytest.mark.parametrize("raw,expected", [
    ("{}", ValueError),
    ('{"id": 1}', None),
], ids=["empty-object", "valid"])
def test_validates_schema(raw, expected): ...
```
