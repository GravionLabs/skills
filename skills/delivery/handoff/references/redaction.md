# Redaction

Replace with `<REDACTED>`:

- API keys, tokens (`ghp_…`, `sk-…`, `Bearer …`), passwords, private keys, session cookies, connection strings with credentials, values of `.env` files.
- URLs with embedded credentials or signed query strings.
- Personal data: names of people other than in a public issue link, email addresses, phone numbers, and the user name in home paths (`/home/<REDACTED>/…`).

Keep the name of a variable (`GH_TOKEN`) but never its value. When unsure, redact. A pointer (issue number, SHA, public URL) is not personal data.
