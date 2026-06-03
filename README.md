# A2gent Brute Chrome Adapter

This repository contains an unpacked Chrome MV3 extension for creating and continuing local Brute sessions from the current browser page.

## Setup

1. Start Brute locally. The default HTTP API port is `5445`:

   ```bash
   brute server
   # or
   brute
   ```

2. Open Chrome `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this `adapter-chrome` directory.
5. Navigate to any `http://` or `https://` page and click the extension icon. The in-page bottom overlay toggles open/closed.

The extension defaults to `http://localhost:5445`. Connection and project-context controls are hidden during the normal diagnosis flow; click **Settings** in the overlay when you need to override the local endpoint, refresh projects, or change the selected project. The endpoint remains loopback-only: `localhost`, `127.0.0.1`, or `::1` over HTTP/HTTPS. No authentication is used; this is intentionally a local-machine trust model.

## Project URL patterns

Project auto-detection is configured in Caesar under **Project Settings → Browser URL auto-detection**.

Pattern rules for the MVP:

- One absolute URL pattern per line.
- Use URLPattern-compatible full URL strings with literal URL components plus `*` wildcards only.
- Examples:
  - `https://example.com/*`
  - `https://*.example.test/app/*`
- Advanced URLPattern syntax such as groups, named parameters, custom tokens, brackets, or regex-like syntax is not supported.

When multiple project patterns match the current URL, the extension scores them in this order:

1. Fewer `*` wildcards wins.
2. If tied, more literal characters wins.
3. If tied, longer literal pathname wins.
4. If still tied across different projects, no project is auto-selected and the user must choose manually.

## Diagnostic capture model

Creating a session is an explicit user-initiated diagnosis action. The extension sends a broad diagnostic bundle to the selected local Brute project session:

- Current page URL and title.
- User prompt text.
- Current selected text when present.
- Visible-page screenshot as an image attachment.
- DOM/text snapshot.
- Console logs and runtime/page errors observed after the extension hook loaded.
- Browser-observed fetch/XHR network records limited to the latest 20 endpoint-level entries: captured time, type, method, URL without query/fragment, status, duration, and compact error text. Request/response headers and bodies are not included.
- Performance/resource timing entries limited to the latest 20 compact endpoint-level entries.

The diagnostic bundle is embedded as a machine-readable JSON block in the Brute message text. Screenshots are sent as Brute image attachments. Created sessions include metadata labels such as `source: "adapter-chrome"` and `created_by: "adapter-chrome-extension"`, so Caesar can display that they came from the extension.

## Exclusions and sensitivity

The extension intentionally does **not** collect or transmit cookies or browser storage state. It does not read `document.cookie`, `localStorage`, `sessionStorage`, IndexedDB, Cache Storage, or similar persisted browser storage. Network diagnostics also omit request/response headers, request/response bodies, URL query strings, and URL fragments.

Aside from those explicit exclusions, the MVP diagnostic bundle may contain highly sensitive page data, including PII, page text, form text rendered in the DOM, screenshots, console output, and runtime errors. Use it only with pages and local Brute instances you trust.

## Inline continuation

After the initial session is created, the overlay stays in an inline continuation mode:

- Each follow-up message automatically includes a lightweight refreshed JSON context containing `captured_at`, current URL, current title, and current selected text trimmed to 4,000 characters.
- Follow-ups do not automatically recapture screenshots, DOM snapshots, console dumps, or network dumps.
- The **Full recapture & send** button explicitly sends a fresh full diagnostic bundle and screenshot.
