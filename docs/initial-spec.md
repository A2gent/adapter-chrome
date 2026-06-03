# Task Specification: initial-spec

## Task
lets create in adapter-chrome a chrome extension that user will install so that agents (brute) could access its contents without the need of chrome MCP or chrome instance management with other things.

chrome extension should allow user to 
- manage (create) inline sessions similar to how its done in caesar app.
- select a project context it is working in. in caesar web app, under project settings lets add a domain name for automatic detection which URLs are tied to which project and automatically select correct project.
- idea is that chrome extension would be used to debug UI related issues by user being on specific page and directly sending error or screenshot of the page automatically with URL and console/network log context, without the need to do it manually or agent needing to reproduce the bug
- select text on the page and pass it to the session context too (a-la "translate this" or "investigate this further")
- created sessions would thus be automatically later accessible/visible in caesar app

caesar and brute project repos are in ~/git/a2gent/ folder

## Context
- Project: adapter-chrome
- Related repos mentioned by the request: `~/git/a2gent/adapter-chrome`, `~/git/a2gent/caesar`, `~/git/a2gent/brute`
- Git branch: not resolved yet
- This document is the single source of truth for planning this task before implementation.
- Current codebase observations from initial analysis:
  - `adapter-chrome` currently contains only this specification document. The extension implementation has not started yet.
  - Caesar already has inline session creation/opening concepts in project views (`src/pages/projects/hooks/useProjectViewController.tsx`, `src/components/chat/SessionCreationPanel.tsx`).
  - Caesar project settings currently expose project name and folder, but no URL/domain mapping field (`src/pages/projects/pages/ProjectSettingsPage.tsx`, `src/pages/projects/tabs/ProjectSettingsTab.tsx`).
  - Caesar `Project` and `UpdateProjectRequest` currently support only `name` and `folder` (`src/api/types.ts`, `src/api/projects.ts`).
  - Brute `Project` storage currently supports only `id`, `name`, and optional `folder`, so automatic URL-to-project detection requires backend/storage changes outside `adapter-chrome` (`internal/storage/store.go`).
  - Brute session APIs already support `project_id`, session `metadata`, and image attachments, which may be reusable for extension-created sessions and screenshots (`../caesar/src/api/sessions.ts`, `../brute/internal/http/server.go`).
  - Caesar currently defaults API clients to `http://localhost:5445`, while Brute CLI server startup currently exposes a configurable/random port model, so local extension onboarding must standardize or document the expected Brute base URL (`../caesar/src/api/client.ts`, `../brute/cmd/aagent/main.go`).

## Requirements

### Functional
- [ ] REQ-F-001 Provide a Chrome extension that lets a user create Brute sessions from the browser without using Chrome MCP or managed Chrome instance workflows.
- [ ] REQ-F-002 Allow the user to associate each created session with a Brute project context.
- [ ] REQ-F-003 Support manual project selection in the extension.
- [ ] REQ-F-004 Support automatic project preselection based on the current page URL, using project-level full URL patterns configured in Caesar.
- [ ] REQ-F-005 Allow the user to capture current page context when creating a session.
- [ ] REQ-F-006 Provide a UI-debug reporting flow from the current page that sends as much diagnostic context as technically feasible to the created Brute session, constrained only by Chrome APIs, granted permissions, and supported backend payloads.
- [ ] REQ-F-007 Sessions created from the extension shall be persisted in Brute and later visible in Caesar as regular project sessions.
- [ ] REQ-F-008 The MVP shall support both creating a new session and continuing that session inline inside the extension.
- [ ] REQ-F-009 The inline continuation flow shall reuse existing Brute session/chat APIs where possible rather than introducing a separate extension-only conversation model.
- [ ] REQ-F-010 The MVP extension session-management scope is limited to reopening and continuing the session created from the current browser workflow; broader session browsing/search inside the extension is out of scope.
- [ ] REQ-F-011 Caesar project settings shall support storing one or more full URL patterns per project for automatic project detection by the extension.
- [ ] REQ-F-012 When the current page matches a configured project URL pattern, the extension shall auto-select that project before the user submits a new session.
- [ ] REQ-F-013 When multiple projects match the current page URL, the unique most specific matching pattern shall win.
- [ ] REQ-F-014 Caesar and the extension shall use absolute `URLPattern`-compatible pattern strings in MVP, limited to literal URL components plus `*` wildcards. Advanced regex-like groups, custom token syntax, and named parameters are out of scope.
- [ ] REQ-F-015 Pattern precedence shall be determined in this order: fewer wildcard usages wins; if tied, more literal characters wins; if tied, longer literal pathname wins; if still tied across different projects, the extension shall not auto-select any project and shall require manual user choice.
- [ ] REQ-F-016 The initial full diagnostic bundle shall include at minimum the current page URL, page title, user-entered prompt text, selected text when present, and a screenshot of the active page.
- [ ] REQ-F-017 The MVP shall attempt maximum technically feasible capture for all approved diagnostic categories, including page/DOM snapshot data, console logs, runtime/page errors, network activity records, request/response metadata, request/response bodies, and other browser-observable state relevant to diagnosis, while excluding cookies and browser storage.
- [ ] REQ-F-018 Maximum capture of approved diagnostic categories shall be the default diagnosis behavior rather than an optional advanced mode.
- [ ] REQ-F-019 The extension shall not collect or transmit cookies or browser storage state, including localStorage, sessionStorage, IndexedDB, Cache Storage, or similar persisted browser storage.
- [ ] REQ-F-020 Inline continuation shall use a hybrid diagnostic-refresh approach.
- [ ] REQ-F-021 Each follow-up user message in inline continuation shall automatically include a minimal lightweight refreshed page-context package containing `captured_at`, current page URL, current page title, and current selected text when non-empty (trimmed to 4,000 characters).
- [ ] REQ-F-022 Automatic per-message lightweight refresh shall not automatically recapture screenshots, DOM snapshots, console dumps, or network dumps.
- [ ] REQ-F-023 The extension shall let the user explicitly trigger a full recapture of the maximum diagnostic bundle during inline continuation.
- [ ] REQ-F-024 The extension shall default the Brute base URL to `http://localhost:5445` and allow the user to override it to another loopback URL.
- [ ] REQ-F-025 The MVP shall encode diagnostic context as a machine-readable JSON block embedded in the message text sent to Brute, with screenshots attached as images and extension/session source labels stored in session metadata.

### Non-functional
#### Performance
- [ ] REQ-NF-PERF-001 Opening the bottom overlay after clicking the extension icon should complete within 300 ms on a typical desktop page.
- [ ] REQ-NF-PERF-002 Automatic project detection should complete within 250 ms after the overlay opens for up to 500 stored URL patterns.
- [ ] REQ-NF-PERF-003 Automatic lightweight refresh before a follow-up send should add no more than 300 ms on a typical page.
- [ ] REQ-NF-PERF-004 Manual full recapture shall show visible progress state within 500 ms of user trigger, even if the recapture itself takes longer.

#### Security
- [ ] REQ-NF-SEC-001 The extension shall request the minimum Chrome permissions needed for the approved maximum-diagnostics MVP.
- [ ] REQ-NF-SEC-002 The diagnosis flow shall be explicitly user-initiated and treated as consent to send a broad diagnostic bundle from the active page to the user's local Brute instance, excluding cookies and browser storage.
- [ ] REQ-NF-SEC-003 Aside from the explicit cookies/storage exclusion, the MVP shall not rely on privacy-based redaction or data minimization as a product boundary; any further exclusions must be justified by technical infeasibility or an explicit later decision.
- [ ] REQ-NF-SEC-004 The MVP shall use a trusted local-connection model with no authentication between the extension and Brute.
- [ ] REQ-NF-SEC-005 The MVP shall only allow loopback Brute endpoints (`localhost`, `127.0.0.1`, or `::1`) in extension settings.

#### Quality
- [ ] REQ-NF-QUAL-001 Reuse existing Brute session APIs and Caesar session concepts where possible to minimize duplicate behavior.
- [ ] REQ-NF-QUAL-002 Cross-repo changes shall be explicitly identified by repository (`adapter-chrome`, `caesar`, `brute`) before implementation starts.
- [ ] REQ-NF-QUAL-003 The final design shall define how extension-created sessions are distinguished in metadata for debugging, observability, and future filtering.
- [ ] REQ-NF-QUAL-004 The final design shall define how large or structured diagnostic artifacts are represented when Brute APIs support only text, images, and limited metadata in some flows.
- [ ] REQ-NF-QUAL-005 The URL-pattern matching and scoring logic used by Caesar validation and extension auto-selection shall be consistent.

#### Complexity
- [ ] REQ-NF-CPLX-001 Prefer the smallest viable MVP that validates extension-created sessions and inline continuation while honoring the approved maximum-diagnostics direction.
- [ ] REQ-NF-CPLX-002 Avoid introducing a second session model if existing Brute sessions can represent extension-created work.
- [ ] REQ-NF-CPLX-003 Defer global session browsing, remote Brute connectivity, and authenticated multi-user deployment to later phases.

#### Documentation
- [ ] REQ-NF-DOC-001 Document required setup for the extension, including how it connects directly to Brute and any permissions the user must grant.
- [ ] REQ-NF-DOC-002 Document project URL pattern behavior, including syntax, validation, precedence, and fallback behavior.
- [ ] REQ-NF-DOC-003 Document that the diagnosis flow may capture and transmit highly sensitive page data to Brute without privacy-oriented minimization, while still excluding cookies and browser storage.
- [ ] REQ-NF-DOC-004 Document the local-only, no-auth trust model and the loopback-only Brute URL constraint.

#### UX
- [ ] REQ-NF-UX-001 The extension must let the user trigger the main flow without manually reproducing the issue inside an agent-controlled browser.
- [ ] REQ-NF-UX-002 The project-selection UX must clearly show whether the project was auto-detected or manually chosen.
- [ ] REQ-NF-UX-003 The overlay must clearly communicate that the diagnosis flow can send a broad diagnostic bundle from the active page to Brute.
- [ ] REQ-NF-UX-004 The MVP primary UI surface shall be an in-page bottom overlay injected by the extension, not a browser-managed side panel.
- [ ] REQ-NF-UX-005 Clicking the extension icon should toggle the bottom overlay open and closed on the active page.
- [ ] REQ-NF-UX-006 On desktop, the overlay shall open full-width at the bottom with a default height of 320 px and be resizable between 240 px and 640 px.
- [ ] REQ-NF-UX-007 On narrower viewports, the overlay shall stay bottom-anchored and may grow up to 60% of viewport height.
- [ ] REQ-NF-UX-008 Inline continuation shall automatically send a lightweight refreshed page-context package on every follow-up message and expose an explicit control for full diagnostic recapture.

## Decisions
- [x] DEC-001 The extension communicates directly with the Brute HTTP API.
- [x] DEC-002 The MVP primary interaction surface is an in-page bottom overlay injected by the extension. Clicking the extension icon toggles the overlay on the active page.
- [x] DEC-003 The product direction for the diagnosis flow is to capture as much diagnostic data as possible within the approved exclusions; privacy minimization is not a general MVP boundary.
- [x] DEC-004 The MVP scope for inline sessions is create + continue inside the extension. Full session-management parity with Caesar is not included.
- [x] DEC-005 The MVP deployment target is a local Brute instance running on the user's machine; hosted or remote Brute connectivity is out of scope.
- [x] DEC-006 The MVP uses no authentication between the extension and Brute, relying on local-machine trust instead.
- [x] DEC-007 Cookies and browser storage are explicitly out of scope for diagnostic capture, even in the maximum-diagnostics direction.
- [x] DEC-008 The specification and implementation scope explicitly spans coordinated changes across all three repositories: `adapter-chrome`, `caesar`, and `brute`.
- [x] DEC-009 Inline continuation uses a hybrid diagnostic-refresh model rather than initial-only capture or full recapture on every message.
- [x] DEC-010 The approved hybrid refresh policy is lightweight automatic refresh on every follow-up message plus explicit user-triggered full recapture.
- [x] DEC-011 MVP URL patterns use absolute `URLPattern`-compatible strings with `*` wildcards only.
- [x] DEC-012 Pattern resolution uses unique most-specific match wins; exact cross-project ties fall back to manual selection.
- [x] DEC-013 The automatic lightweight refresh payload contains only `captured_at`, current URL, current title, and selected text when present.
- [x] DEC-014 The default local Brute base URL is `http://localhost:5445`, but the user may override it to another loopback URL.
- [x] DEC-015 Diagnostic context is represented as machine-readable JSON embedded in message text, plus image attachments and session metadata labels.

## Implementation boundaries
- [ ] BOUND-001 `adapter-chrome`: extension manifest, content-script overlay injection, overlay UI, project selection UI, local Brute URL setting, automatic URL matching, initial full capture, lightweight refresh, manual full recapture, and Brute chat/session integration.
- [ ] BOUND-002 `caesar`: project settings data model and UI for URL patterns, validation/help text for pattern syntax, and any session UI improvements needed to identify extension-created sessions.
- [ ] BOUND-003 `brute`: project storage/API support for URL patterns, stable local HTTP port guidance/support for extension onboarding, persistence of extension source metadata, and any support needed for structured diagnostic context handling.

## Open questions
- [x] Q-001 Approved communication model: direct to Brute HTTP API.
- [x] Q-002 Approved MVP scope for inline sessions: create + continue inline conversation inside the extension.
- [x] Q-003 Approved project-mapping model: full URL patterns configured per project in Caesar.
- [x] Q-004 Approved diagnostic direction: maximum technically feasible capture for approved categories, excluding cookies and browser storage.
- [x] Q-005 Approved MVP trigger/surface: in-page bottom overlay, toggled by clicking the extension icon.
- [x] Q-006 Approved repo scope: coordinated changes across `adapter-chrome`, `caesar`, and `brute`.
- [x] Q-007 Approved deployment model: local Brute only.
- [x] Q-008 Approved authentication model: no auth on the local extension-to-Brute connection.
- [x] Q-009 Approved precedence rule: most specific matching project URL pattern wins.
- [x] Q-010 Approved refresh direction: hybrid diagnostic capture during inline continuation.
- [x] Q-011 Approved hybrid refresh policy: lightweight automatic refresh every message + explicit manual full recapture.
- [x] Q-012 Approved pattern syntax decision: `URLPattern`-compatible absolute strings using `*` wildcards only.
- [x] Q-013 Approved lightweight refresh principle: keep the automatic per-message refresh minimal rather than broad.

## Ambiguities / risks
- [ ] RISK-001 The current Caesar and Brute project models do not include URL-pattern mapping, so automatic project detection requires cross-repo schema, API, storage, and UI changes.
- [ ] RISK-002 Even with cookies/storage excluded, the approved broad-diagnostics direction means sessions may still contain highly sensitive data such as tokens in headers, request bodies, page content, screenshots, or PII, increasing exposure risk in Brute, Caesar, exports, logs, and downstream agent processing.
- [ ] RISK-003 The local/no-auth design reduces setup friction but makes any local Brute HTTP listener highly sensitive; loopback-only exposure and any remaining origin constraints must be implemented carefully.
- [ ] RISK-004 The current Brute CLI defaults to a random HTTP port unless configured; the MVP must standardize or clearly document how the extension discovers or is pointed to the correct local base URL.
- [ ] RISK-005 An injected bottom overlay can conflict with page layout, z-index, focus management, CSP restrictions, shadow DOM usage, and site-specific styling unless the implementation isolates itself carefully.
- [ ] RISK-006 Full URL pattern matching can become confusing or brittle unless the pattern syntax, validation, and specificity scoring are implemented consistently.
- [ ] RISK-007 Capturing "as much as possible" may require elevated Chrome extension capabilities and can materially increase implementation complexity, performance impact, and Chrome Web Store review sensitivity.
- [ ] RISK-008 Existing Brute follow-up chat APIs currently accept message text and images, but not arbitrary structured diagnostic payloads per follow-up message, so richer continuation context relies on the approved text-embedded JSON convention or requires later API extensions.

## Acceptance criteria
- [ ] AC-001 The specification explicitly defines the direct-to-local-Brute no-auth connection model, including the loopback-only URL constraint and default base URL behavior.
- [ ] AC-002 The specification explicitly defines the MVP user flows and bottom-overlay UX, including overlay sizing and toggle behavior.
- [ ] AC-003 The specification explicitly defines the URL-pattern syntax, validation, specificity scoring, tie fallback, and manual-selection behavior.
- [ ] AC-004 The specification explicitly defines the exact initial full diagnostic bundle, the approved maximum-capture behavior, the explicit cookies/storage exclusions, and the representation of that bundle in Brute session creation flows.
- [ ] AC-005 The specification explicitly defines the exact lightweight automatic refresh payload, the manual full-recapture behavior, and the representation of both in Brute continuation flows.
- [ ] AC-006 The specification explicitly lists required changes by repository (`adapter-chrome`, `caesar`, `brute`).
- [ ] AC-007 The specification explicitly defines how extension-created sessions appear in Caesar and how they are represented in Brute metadata.
- [ ] AC-008 All blocking product/scope decisions needed for implementation have been resolved in this document.

## Implementation sessions
- No implementation sessions have been created yet.
