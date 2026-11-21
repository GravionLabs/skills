# Components

Read when you add, change or compose a component. Paths and names are the project's own.

## Inventory

| Component | Use it for | Path |
| :--- | :--- | :--- |
| `<Button>` | actions | `<path>` |
| `<Input>` | single-line text | `<path>` |
| `<Dialog>` | blocking questions | `<path>` |

## Rules

- A new component is added only when no inventory entry fits; extend a variant first.
- Props describe roles (`variant="danger"`), not looks (`color="red"`).
- Every component lists its states: default, hover, focus, active, disabled, loading, error.
- Spacing between siblings comes from the spacing scale in `<token file>`, set by the parent, not the child.
- Icons: one set (`<icon set>`), one size per context (`<sizes>`); an icon-only button has an accessible name.
