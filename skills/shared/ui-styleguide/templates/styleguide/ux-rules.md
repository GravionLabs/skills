# UX rules

Read when you add a flow, a form, a dialog or an error message.

## Feedback

- Feedback within 100 ms; work over 1 s shows progress; work over 10 s can be cancelled.
- Success is confirmed where the user looks (inline), not only in a toast.

## Forms

- Every field has a visible label; a placeholder is not a label.
- Validate on blur and on submit; the error names the field and the fix.
- Submit stays enabled; an invalid submit moves focus to the first error.

## Dialogs and destructive actions

- A dialog has one primary action and a way out (Escape and a close button).
- A destructive action names what is lost ("Delete 3 files"), or offers undo.

## Messages

- Error text says what happened and what to do next, in plain words, without codes alone.
- Empty states say how to fill the view.
