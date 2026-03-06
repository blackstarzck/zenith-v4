## Encoding Safety

- For files that may contain Korean text, do not rewrite whole files via shell commands.
- Forbidden commands/patterns:
  - `Set-Content`
  - `Out-File`
  - shell redirection (`>`)
  - `WriteAllText`
  - `WriteAllLines`
- Use `apply_patch` for code/file edits.
- If a large-scale replacement is needed, ask for user approval first.
- After edits, check `git diff` for mojibake or broken string literals.
- If any encoding corruption is detected, stop and report immediately.

