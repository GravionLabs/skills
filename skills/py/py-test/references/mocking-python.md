# Mocking in pytest

## pytest-mock (recommended)

Install: `uv add --dev pytest-mock`

```python
# Create mock with spec (like Substitute.For<IFoo>())
def test_order_service_calls_repo(mocker):
    repo = mocker.create_autospec(OrderRepository)
    repo.find_by_id.return_value = Order(id=1)
    service = OrderService(repo)
    result = service.get(1)
    repo.find_by_id.assert_called_once_with(1)
    assert result.id == 1

# Side effect / exception
def test_order_service_raises_when_not_found(mocker):
    repo = mocker.create_autospec(OrderRepository)
    repo.find_by_id.side_effect = NotFoundError("not found")
    with pytest.raises(NotFoundError):
        OrderService(repo).get(99)

# Patch module-level object
def test_uses_current_time(mocker):
    mocker.patch("myapp.orders.datetime", autospec=True).now.return_value = ...
```

## unittest.mock (stdlib fallback)

```python
from unittest.mock import MagicMock, patch, AsyncMock, ANY

repo = MagicMock(spec=OrderRepository)
repo.find_by_id.return_value = Order(id=1)

with patch("myapp.orders.send_email") as mock_email:
    ...
    mock_email.assert_called_once_with(recipient=ANY)
```

## Specialised

| Need                 | Library                 | Install                  |
| -------------------- | ----------------------- | ------------------------ |
| HTTP mocking (httpx) | respx                   | `uv add --dev respx`     |
| Time/date            | freezegun               | `uv add --dev freezegun` |
| Async mocks (stdlib) | unittest.mock.AsyncMock | built-in                 |

```python
import respx, httpx

@respx.mock
def test_fetch_order_calls_api():
    respx.get("https://api.example.com/orders/1").mock(return_value=httpx.Response(200, json={"id": 1}))
    result = fetch_order(1)
    assert result["id"] == 1

from freezegun import freeze_time

@freeze_time("2024-06-01")
def test_order_expires_after_30_days(): ...
```
