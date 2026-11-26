# Helix recipes

Inputs: [components.md](components.md).

## Labelled field with hint and error

```html
<hx-field label="Project name" hint="Shown in the sidebar" [error]="nameError()" required>
  <input hx-input formControlName="name" fluid />
</hx-field>
```

`hx-field` writes the label and the ARIA wiring; write no `<label for>` or `aria-describedby`.

## Form: one primary action, saving state, focus, Enter and Esc

```ts
import {
  Component,
  ElementRef,
  afterNextRender,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { HxButton, HxField, HxInput } from '@gravionlabs/helix-ui';
import { ValidatorKey, Validators } from '@gravionlabs/helix-ui/validators';

@Component({
  selector: 'app-project-form',
  imports: [ReactiveFormsModule, HxButton, HxField, HxInput],
  templateUrl: './project-form.html',
})
export class ProjectForm {
  readonly cancelled = output<void>();
  readonly saving = signal(false);
  readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', Validators.required('Enter a name')],
  });
  private readonly first = viewChild.required<ElementRef<HTMLInputElement>>('first');

  constructor() {
    afterNextRender(() => this.first().nativeElement.focus());
  }

  nameError(): string | null {
    return this.form.controls.name.errors?.[ValidatorKey.Required] ?? null;
  }

  save(): void {
    if (this.saving()) return;
    if (this.form.invalid) return this.form.markAllAsTouched();
    this.saving.set(true);
    // call the service; set `saving` back to false when it settles
  }
}
```

```html
<form [formGroup]="form" (ngSubmit)="save()" (keydown.escape)="cancelled.emit()">
  <hx-field label="Name" [error]="nameError()" required>
    <input #first hx-input formControlName="name" />
  </hx-field>
  <button hx-button type="button" variant="text" severity="secondary" (click)="cancelled.emit()">
    Cancel
  </button>
  <button hx-button type="submit" [loading]="saving()">Save</button>
</form>
```

- Enter submits through the one `type="submit"` button; every other button is `type="button"`.
- `[loading]` ignores clicks, including the click Enter triggers, and keeps the focus; do not also set `disabled`.

## Dialog with footer actions

```html
<hx-dialog [(visible)]="open" header="Rename project" size="md">
  <form id="rename" [formGroup]="form" (ngSubmit)="save()">
    <hx-field label="Name" [error]="nameError()" required>
      <input hx-input formControlName="name" />
    </hx-field>
  </form>
  <button
    hxDialogFooter
    hx-button
    type="button"
    variant="text"
    severity="secondary"
    (click)="open.set(false)"
  >
    Cancel
  </button>
  <button hxDialogFooter hx-button type="submit" form="rename" [loading]="saving()">Save</button>
</hx-dialog>
```

- `open` is a `signal(false)`; add `HxDialog` to `imports`.
- The footer is outside the form: `form="rename"` keeps Enter and submit working.
- The first control gets the focus, Escape closes (`closeOnEscape`); no code for either.

A component opened in a dialog has no footer slot: its template holds the form and the action row.

```ts
const ref = this.dialogs.open<RenameDialog, string>(RenameDialog, {
  header: 'Rename project',
  width: '32rem',
  data: { name },
});
ref.closed.subscribe((newName) => newName && this.rename(newName));
// in RenameDialog: data = inject(HX_DIALOG_DATA) as { name: string }; ref = inject(HxDialogRef); this.ref.close(name)
```

## Confirmation

```ts
private readonly confirmation = inject(HxConfirmationService);

async remove(project: Project): Promise<void> {
  const accepted = await this.confirmation.confirmAsync({
    header: 'Delete project',
    message: `Delete "${project.name}"?`,
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    acceptSeverity: 'danger',
  });
  if (accepted) this.delete(project);
}
```

Root component, once: `<hx-confirm-dialog />` (`HxConfirmDialog` in `imports`). For a question at the button, pass `target: event` and add `<hx-confirm-popup />`.

## Path field with picker

An input group is not a field control: label it yourself.

```html
<label for="folder">Folder</label>
<hx-input-group>
  <input hx-input id="folder" formControlName="folder" />
  <button hx-button type="button" variant="outlined" (click)="pickFolder()">Browse…</button>
</hx-input-group>
```

`imports`: `HxInputGroup`, `HxInput`, `HxButton`. The picker writes with `form.controls.folder.setValue(path)`.

## List of rows

Rows instead of raw or text buttons:

```html
<hx-list aria-label="Projects">
  @for (project of projects(); track project.id) {
  <button
    hx-list-row
    type="button"
    [selected]="project.id === chosen()"
    (click)="chosen.set(project.id)"
  >
    <span class="hx-list-row-label">{{ project.name }}</span>
    <span class="hx-list-row-meta">{{ project.updated }}</span>
  </button>
  }
</hx-list>
```

`imports`: `HxList`, `HxListRow`. A row holds no other button, link or field. Navigation: `a[hx-list-row]` with `routerLink` and `current`.
