# Playbook

- Project URL auto-detection tests need a full URL pattern such as `https://app.example.test/*`. A bare hostname will not match `location.href`.
- When splitting overlay HTML assertions into a new test, move leftover `assert.match` lines with the original test. Stray closing braces fail the whole `contentUi` file before any assertion runs.
- Session create payloads should omit empty `task` / `images` / `provider` / `model` keys. `undefined` fields break strict object comparisons even though `JSON.stringify` drops them.
