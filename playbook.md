# Playbook

- Project URL auto-detection tests need a full URL pattern such as `https://app.example.test/*`. A bare hostname will not match `location.href`.
- When splitting overlay HTML assertions into a new test, move leftover `assert.match` lines with the original test. Stray closing braces fail the whole `contentUi` file before any assertion runs.
- Session create payloads should omit empty `task` / `images` / `provider` / `model` keys. `undefined` fields break strict object comparisons even though `JSON.stringify` drops them.
- A 30% sidebar on a 1000px test viewport is 300px, which is below the 320px minimum width. Assert default-width math on a viewport wide enough that 30% is above the min.
- Read workspace `AGENTS.md` before Git probes: the workspace root is not a repository; use the owning component directory.
- Host-page CSP can block `fetch(data:...)` even in an isolated content-script world. Decode capture base64 directly into a Blob, and test on a restrictive real site.
- `captureVisibleTab` captures the active tab in the window, not necessarily the command's page. Activate the intended tab before screenshot verification.
- CDP `Extensions.loadUnpacked` succeeding does not guarantee `Extensions.triggerAction` is allowed. If Chrome rejects the action, report UI/session verification as pending rather than treating injected-helper checks as end-to-end validation.

- A macOS Chrome launcher PID may exit before cleanup. Close a temporary browser through CDP or tolerate an already-exited PID.

- When minifying diagnostic JSON, update both exact string assertions and regexes that assumed spaces after colons.

- Chrome API mocks throw host-realm errors into the background VM. Existing `instanceof Error` formatting may include an `Error:` prefix; assert the error detail rather than assuming identical realm formatting.

- Run component-relative edits and tests from the component repository root, not the session working directory if it is nested beneath a package.

- File-edit tool paths resolve from the project root, unlike bash commands with a component workdir. Use project-relative paths (for example `adapter-chrome/...`) with file-edit tools.
