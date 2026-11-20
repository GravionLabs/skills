# Allowlist rule

A secret that is not a secret (a fake token in a test, an example key in a doc) is allowlisted with a reason, never silently.

## Order

1. A real finding is **rotated first** (revoke, issue a new one, remove it from the code). History is not rewritten for this.
2. Only then, if the old value stays in history, its fingerprint is allowlisted.
3. A fake value is allowlisted at once, with the reason that it is fake.

## Forms

- `.gitleaksignore`: one fingerprint per line (`gitleaks` prints it as `Fingerprint:`), with a `#` comment line directly above that gives the reason.

  ```
  # Fake token of the parser test fixture, not a credential (#123)
  3f2a9c1:test/fixtures/token.txt:generic-api-key:4
  ```

- `.gitleaks.toml`: every `[[allowlists]]` entry has a `description` that gives the reason (template: `templates/.gitleaks.toml`).
- Inline `gitleaks:allow` is not used: it hides the exception from the review of the allowlist.

`node scripts/check-allowlist.mts [repo-dir]` fails (exit 1) for a fingerprint without a reason comment and for an allowlist entry without a description. Wire it as a `checks` entry.

## Betterleaks

Betterleaks reads the same `.gitleaks.toml`; the template uses only keys both tools read. Switch when Betterleaks 2.0 is final and the team wants it; the CLI name in `Invoke-SecretScan.ps1` and the install hint change, the configuration does not.
