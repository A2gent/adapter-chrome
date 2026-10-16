# A2gent Brute Chrome extension
This repository contains an unpacked Chrome MV3 extension for creating and continuing local Brute sessions from the current browser page.

Features:
- automatic screenshot capturing, page URL and html inclusion for the context
- numbered arrow and region annotation capability
- URL-based automatic project selection to correctly select which domain area it falls into

<img width="1598" height="800" alt="Screenshot 2026-06-20 at 00 59 42" src="https://github.com/user-attachments/assets/7bf47a1e-dbb3-4fef-a0c1-eb4e3ef96e9a" />

## Modes: audio (default), design and sync

- **Audio** (default): HearHear reads articles aloud via the local Brute Speech API. The player appears on article pages; the toolbar icon shows/hides it. Source: `src/hearhear/`, options page: `hearhear/options.html` (Brute URL, TTS model).
- **Design**: the HearHear player is removed from pages and the toolbar icon toggles the session overlay (as before).
- **Sync** (LinkedIn → People): on LinkedIn profile pages and people lists (search, My Network, company/school people) a panel lists the profiles on the page. Each profile is matched to a Brute person card by `socials.linkedin`; unlinked ones get a name field (pre-filled when a card name/alias matches) and a 🔗 link / + create button. Syncing calls `PUT /projects/{id}/people/linkedin-sync`: it sets `socials.linkedin`, fills empty `role` / `company` / `location`, and rewrites the card's `## LinkedIn` section (headline, about, experience, education). Use ↻ on a profile page to refresh a linked card; list rows only link, since they lack profile details. The people project defaults to the adapter's selected project and is remembered per panel. Source: `src/peopleSync/`.
- Switch with the toolbar icon's right-click menu (stored in `chrome.storage.local` as `a2gent.adapterChrome.mode`).
- HearHear is ES modules, so run `npm install && npm run build` before loading the unpacked extension (outputs `dist/`, git-ignored).

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
5. In the extension details, enable **Allow access to file URLs** if you want to use the adapter on local `file:///...` pages. Chrome keeps this permission disabled until you explicitly opt in.
6. Navigate to any `http://`, `https://`, or enabled `file://` page and click the extension icon. The in-page right-side overlay toggles open/closed.

<img width="809" height="461" alt="Screenshot 2026-06-10 at 01 03 07" src="https://github.com/user-attachments/assets/26b4de0c-9f49-417d-bd62-6df9ebc84c70" />


The extension defaults to `http://localhost:5445`. The new-session form selects project context plus the same provider/model/agent target used in Caesar. Click **Settings** in the overlay when you need to override the local Brute endpoint. The endpoint remains loopback-only: `localhost`, `127.0.0.1`, or `::1` over HTTP/HTTPS. No authentication is used; this is intentionally a local-machine trust model.

On `https://` pages the content scripts do **not** fetch `http://localhost` directly. Chrome treats that as a public-origin-to-loopback Private Network Access request and blocks it before normal CORS headers can help. Instead, the content scripts send messages to the extension background service worker, and the service worker performs Brute HTTP requests using the loopback `host_permissions` declared in `manifest.json`. If HTTPS pages show `loopback address space` errors, reload the unpacked extension so the latest background proxy code is active.

## Agent tab navigation

The `chrome_extension` tool supports `open_tab`, `navigate`, and `close_tab`.
The first two take an absolute HTTP(S) `url`. All three run in the service
worker through `chrome.tabs`, without page `eval`, popup gestures, or host-page
CSP restrictions. No additional manifest permissions are required.

- `open_tab` opens a new active tab and leaves the source page intact.
- `navigate` changes the tab belonging to the selected `page_id`.
- `close_tab` closes the tab belonging to the selected `page_id`.
- All three commands require an existing extension-connected source page. Use
  `list_pages` first and pass its `page_id` explicitly for the target tab.
- `open_tab` and `navigate` results contain `tab_id`, `window_id`, and the
  requested `url`; they confirm the tab operation, not that the destination
  has finished loading. `close_tab` returns the closed `tab_id`. After opening
  or navigating, call `list_pages` to find the destination `page_id`, then read
  its content.
- Non-HTTP(S) URLs (including `javascript:`, `data:`, `file:`, and `chrome:`)
  are rejected. Existing file-page support is unchanged.

After updating, reload the extension in `chrome://extensions`, refresh a source
page to reconnect its content script, and restart/update Brute so the new tool
schema is available. A running session may need to refresh its tool definitions.

## Host page event isolation

The overlay is injected into the current page, but keyboard input inside the overlay is isolated from the host page. When focus is in the adapter UI, key events are stopped in both the extension's isolated content-script world and the page's main world before page-level shortcut handlers can consume them, so sites such as YouTube should not toggle playback or navigate while the user types in the extension overlay. Composer textareas use chat-style keyboard behavior: `Enter` submits the current prompt/follow-up, while `Shift+Enter` inserts a newline. The overlay also preserves textarea/input focus and selection across internal re-renders, preventing focus from falling back to the host page while projects load or session status updates.

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

Creating a session is an explicit user-initiated diagnosis action. The extension sends a compact diagnostic bundle to the selected local Brute project session:

- Current page URL and title.
- User prompt text.
- Current selected text when present.
- Visible-page screenshot as an image attachment. If the user uses **Annotate** first, the screenshot includes numbered arrow/region markers only; annotation note text is copied into the prompt as `N: text` references and compact `focus_annotation` JSON references, not rendered over the page.
- Console logs and runtime/page errors observed after the extension hook loaded.

Session screenshots are normalized to CSS pixels using the page's `devicePixelRatio`, capped at a 1280 px long edge (`SCREENSHOT_MAX_LONG_EDGE` in `src/contentScript/pageDiagnostics.js`), and encoded as JPEG at quality 0.8. Numbered markers remain in the full-page view; no extra annotation crop is attached. Attachment MIME type and filename extension match the encoded image. Browser-control screenshots are unchanged.

To verify a release, reload the unpacked extension and the host page, activate that tab, add numbered annotations, and create a session. Check marker readability at the output's native size. Inspect the initial user message's image attachment metadata for `image/jpeg` and a `.jpg` filename, then decode the stored image to confirm its long edge is at most 1280 px. Repeat with **Full recapture & send**. Payload size varies with page content; 100-200 KB is a target, not a hard limit.

DOM/text snapshots and browser-observed fetch/XHR network records are omitted from automatic diagnostic posts because they can be too large. Agents can request page content or network logs on demand through browser-control commands when needed.

The diagnostic bundle is embedded as a machine-readable JSON block in the Brute message text. Screenshots are sent as Brute image attachments. Created sessions include metadata labels such as `source: "adapter-chrome"` and `created_by: "adapter-chrome-extension"`, so Caesar can display that they came from the extension.

## Exclusions and sensitivity

The extension intentionally does **not** collect or transmit cookies or browser storage state. It does not read `document.cookie`, `localStorage`, `sessionStorage`, IndexedDB, Cache Storage, or similar persisted browser storage. Network diagnostics also omit request/response headers, request/response bodies, URL query strings, and URL fragments.

Aside from those explicit exclusions, the MVP diagnostic bundle may contain highly sensitive page data, including PII, page text, form text rendered in the DOM, screenshots, console output, and runtime errors. Use it only with pages and local Brute instances you trust.

## Agent browser control cursor

When an external agent controls the page through the browser adapter, the extension renders a visible virtual cursor and a subtle blue, translucent gradient around the viewport edges. The border and cursor identify active browser control without intercepting page input. They fade after 30 seconds without a new browser-control command, and hide immediately if the control connection disconnects.

## Inline continuation

The overlay docks to the right side of the page at about 30% width. Drag the left edge to resize it. After the initial session is created, the sidebar shows the live Brute conversation and stays in an inline continuation mode:

- Each follow-up message automatically includes a lightweight refreshed JSON context containing `captured_at`, current URL, current title, and current selected text trimmed to 4,000 characters.
- Follow-ups do not automatically recapture screenshots, DOM snapshots, console dumps, or network dumps.
- The **Open Session** button opens the created session in Caesar's browser session detail view.
- The **Full recapture & send** button explicitly sends a fresh full diagnostic bundle and screenshot from the continuation buttons row.
- The **Annotate** button is available before initial creation and before full recapture. Arrow, Rectangle, and Element tools sit in the movable adapter dialog so they travel with the panel. Only the number is shown on screenshots; note text appears in a user-only hover/editor popup and is mirrored into the composer as lines such as `1: resize this button`. **Clear annotations** removes all marks.
