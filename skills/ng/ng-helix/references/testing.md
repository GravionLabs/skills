# Testing Helix components

TestBed and the test runner: the skill `ng-test`. Recipes under test: [recipes.md](recipes.md).

Helix ships no component test harnesses and no `testing` entry point yet ([GravionLabs/helix#1226](https://github.com/GravionLabs/helix/issues/1226) plans them in `@gravionlabs/helix-ui/testing`). Until they ship, test through the DOM as a user does.

## Queries

The examples use `@testing-library/dom` and `@testing-library/user-event`; when the project has neither, ask before adding them. Query `screen` (the whole body): dialogs and select panels render in an overlay outside the fixture. Never select by a Helix class, element id or DOM structure; they are internal.

| Element                           | Query                                                      |
| --------------------------------- | ---------------------------------------------------------- |
| `button[hx-button]`               | `getByRole('button', { name: 'Save' })`                    |
| `input[hx-input]`, text           | `getByRole('textbox', { name: 'Name' })`                   |
| `hx-select`                       | `getByRole('combobox', { name: 'Branch' })`, then `option` |
| `input[hx-checkbox]`              | `getByRole('checkbox', { name: 'Archived' })`              |
| `input[hx-switch]`                | `getByRole('switch', { name: 'Dark mode' })`               |
| `hx-dialog`, service dialog       | `getByRole('dialog', { name: 'Rename project' })`          |
| Confirmation                      | `getByRole('alertdialog', { name: 'Delete project' })`     |
| `hx-list`                         | `getByRole('group', { name: 'Projects' })`                 |
| Row, in `within(list)`            | `getByRole('button', { name: /Atlas/ })`                   |
| `hx-list role="listbox"` and rows | `listbox`, `option`                                        |

State: `aria-pressed` (selected row of a list), `aria-selected` (option), `aria-current`.

## Setup

jsdom has no layout, so a dialog finds nothing visible to focus. Add this to specs that check focus:

```ts
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
});
afterEach(() => vi.restoreAllMocks());
```

Overlays open and close asynchronously: use `findByRole` to wait for an element and `vi.waitFor` to wait for its removal or the focus.

## Form: label, hint, error, ARIA wiring

`NameForm` is the host under test:

```ts
@Component({
  imports: [ReactiveFormsModule, HxField, HxInput],
  template: `
    <hx-field label="Name" hint="Shown in the sidebar" error="Enter a name">
      <input hx-input [formControl]="name" />
    </hx-field>
  `,
})
class NameForm {
  readonly name = new FormControl('', { nonNullable: true, validators: Validators.required });
}
```

```ts
it('shows the error after touch and wires it to the field', async () => {
  const user = userEvent.setup();
  const fixture = TestBed.createComponent(NameForm);
  await fixture.whenStable();
  const input = screen.getByRole('textbox', { name: 'Name', description: 'Shown in the sidebar' });
  expect(input.getAttribute('aria-required')).toBe('true');
  expect(input.hasAttribute('aria-invalid')).toBe(false);
  expect(screen.queryByText('Enter a name')).toBeNull();

  await user.click(input);
  await user.tab();
  await fixture.whenStable();

  expect(input.getAttribute('aria-invalid')).toBe('true');
  const described = input
    .getAttribute('aria-describedby')!
    .split(' ')
    .map((id) => document.getElementById(id)!.textContent!.trim());
  expect(described).toEqual(['Shown in the sidebar', 'Enter a name']);
});
```

Here `Validators` are Angular's. Reading the elements named by `aria-describedby` is the one lookup by id: the id comes from the control, not from the test.

## Dialog: focus, Esc, Enter, loading

`Opener` opens `RenameDialog` with `HxDialogService`. `save` stands for the service call.

```ts
const save = vi.fn();

@Component({
  imports: [ReactiveFormsModule, HxButton, HxField, HxInput],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()">
      <hx-field label="Name"><input hx-input formControlName="name" /></hx-field>
      <button hx-button type="submit" [loading]="saving()">Save</button>
    </form>
  `,
})
class RenameDialog {
  readonly saving = signal(false);
  readonly form = inject(FormBuilder).nonNullable.group({ name: 'Atlas' });
  submit(): void {
    this.saving.set(true);
    save(this.form.getRawValue().name);
  }
}

@Component({
  imports: [HxButton],
  template: `<button hx-button type="button" (click)="open()">Rename</button>`,
})
class Opener {
  private readonly dialogs = inject(HxDialogService);
  open(): void {
    this.dialogs.open(RenameDialog, { header: 'Rename project' });
  }
}
```

```ts
it('focuses the first field, submits on Enter once and returns the focus on Esc', async () => {
  const user = userEvent.setup();
  TestBed.createComponent(Opener).autoDetectChanges();
  const opener = screen.getByRole('button', { name: 'Rename' });

  await user.click(opener);
  await screen.findByRole('dialog', { name: 'Rename project' });
  const input = screen.getByRole('textbox', { name: 'Name' });
  await vi.waitFor(() => expect(document.activeElement).toBe(input));

  await user.keyboard('{Enter}');
  const primary = screen.getByRole('button', { name: 'Save' });
  await vi.waitFor(() => expect(primary.getAttribute('aria-busy')).toBe('true'));
  await user.keyboard('{Enter}');
  await user.click(primary);
  expect(save).toHaveBeenCalledExactlyOnceWith('Atlas');

  await user.keyboard('{Escape}');
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(opener);
});
```

- A `[loading]` button stays enabled and focusable: assert `aria-busy` and that activating it does nothing, not `disabled`.
- Enter needs `user.keyboard`: a synthetic `keydown` submits no form.
- `<hx-dialog [(visible)]>` is tested the same way: click the opener, then query the `dialog` by its `header`.

## Confirmation

`ProjectPage` has `<hx-confirm-dialog />`, a "Delete" button that calls the confirmation recipe's `remove()`, and the spy `deleted`.

```ts
it('asks first, focuses Cancel, rejects on Esc and accepts on Delete', async () => {
  const user = userEvent.setup();
  const fixture = TestBed.createComponent(ProjectPage);
  fixture.autoDetectChanges();
  const trigger = screen.getByRole('button', { name: 'Delete' });
  const ask = async () => {
    await user.click(trigger);
    return screen.findByRole('alertdialog', { name: 'Delete project' });
  };
  const closed = () => vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

  const cancel = within(await ask()).getByRole('button', { name: 'Cancel' });
  await vi.waitFor(() => expect(document.activeElement).toBe(cancel));
  await user.keyboard('{Escape}');
  await closed();
  expect(fixture.componentInstance.deleted).not.toHaveBeenCalled();

  await user.click(within(await ask()).getByRole('button', { name: 'Delete' }));
  await closed();
  expect(fixture.componentInstance.deleted).toHaveBeenCalledOnce();
});
```

## Accessibility check

When the project already has one (`axe-core`, `vitest-axe`, an a11y helper of its own), run it on the rendered component, with a dialog open on `document.body`:

```ts
const result = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
expect(result.violations).toEqual([]);
```

jsdom cannot compute colour contrast; check it in a browser. Do not add an a11y tool unasked.
