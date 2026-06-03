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
  - Brute HTTP server already has CORS support, so browser/extension access is technically possible, but the allowed-origin/authentication model for the extension is not yet specified (`../brute/internal/http/server.go`).

## Requirements

### Functional
- [ ] REQ-F-001 Provide a Chrome extension that lets a user create Brute sessions from the browser without using Chrome MCP or managed Chrome instance workflows.
- [ ] REQ-F-002 Allow the user to associate a created session with a project context.
- [ ] REQ-F-003 Support manual project selection in the extension.
- [ ] REQ-F-004 Support automatic project preselection based on the current page URL, using project-level full URL patterns configured in Caesar.
- [ ] REQ-F-005 Allow the user to capture current page context when creating a session.
- [ ] REQ-F-006 Provide a UI-debug reporting flow from the current page that sends as much diagnostic context as technically feasible to the created Brute session, constrained by Chrome APIs, granted permissions, and supported backend payloads.
- [ ] REQ-F-007 Sessions created from the extension shall be persisted in Brute and later visible in Caesar as regular sessions associated with the selected project.
- [ ] REQ-F-008 The MVP shall support both creating a new session and continuing that session inline inside the extension, rather than create-only submission.
- [ ] REQ-F-009 The inline continuation flow shall reuse existing Brute session/chat APIs where possible rather than introducing a separate extension-only conversation model.
- [ ] REQ-F-010 The extension shall let the user reopen and continue at least the session it just created from the current browser workflow; broader session-list management scope is not yet defined.
- [ ] REQ-F-011 Caesar project settings shall support storing one or more full URL patterns per project for automatic project detection by the extension.
- [ ] REQ-F-012 When the current page matches a configured project URL pattern, the extension shall auto-select that project before the user submits a new session.
- [ ] REQ-F-013 When multiple projects match the current page URL, the most specific matching pattern shall win.
- [ ] REQ-F-014 The specificity rule and tie-break behavior for matching URL patterns shall be explicitly defined and documented.
- [ ] REQ-F-015 The diagnostic bundle shall include at minimum the current page URL, page title, user-entered prompt text, selected text when present, and a screenshot of the active page.
- [ ] REQ-F-016 The MVP shall attempt maximum technically feasible capture for all approved diagnostic categories, including page/DOM snapshot data, console logs, runtime/page errors, network activity records, request/response metadata, request/response bodies, and other browser-observable state relevant to diagnosis, while excluding cookies and browser storage.
- [ ] REQ-F-017 Maximum capture of approved diagnostic categories shall be the default diagnosis behavior rather than an optional advanced mode.
- [ ] REQ-F-018 The extension shall not collect or transmit cookies or browser storage state, including localStorage, sessionStorage, IndexedDB, Cache Storage, or similar persisted browser storage.
- [ ] REQ-F-019 Inline continuation shall use a hybrid diagnostic-refresh approach rather than initial-only capture or full recapture on every message. The exact hybrid policy is not yet defined.

### Non-functional
#### Performance
- [ ] REQ-NF-PERF-001 Creating a session and showing the initial inline conversation from the current page should feel near-immediate to the user; exact latency budget is not yet defined.
- [ ] REQ-NF-PERF-002 Automatic project detection should complete before the user normally submits the session from the opened overlay; exact timing target is not yet defined.

#### Security
- [ ] REQ-NF-SEC-001 The extension shall request the minimum Chrome permissions needed for the approved maximum-diagnostics MVP.
- [ ] REQ-NF-SEC-002 The diagnosis flow shall be explicitly user-initiated and treated as consent to send a broad diagnostic bundle from the active page to the user's local Brute instance, excluding cookies and browser storage.
- [ ] REQ-NF-SEC-003 Aside from the explicit cookies/storage exclusion, the MVP shall not rely on privacy-based redaction or data minimization as a product boundary; any further exclusions must be justified by technical infeasibility or an explicit later decision.
- [ ] REQ-NF-SEC-004 The MVP shall use a trusted local-connection model with no authentication between the extension and Brute.
#### Quality
- [ ] REQ-NF-QUAL-001 Reuse existing Brute session APIs and Caesar session concepts where possible to minimize duplicate behavior.
- [ ] REQ-NF-QUAL-002 Cross-repo changes shall be explicitly identified by repository (`adapter-chrome`, `caesar`, `brute`) before implementation starts.
- [ ] REQ-NF-QUAL-003 The final design shall define how extension-created sessions are distinguished in metadata for debugging, observability, and future filtering.
- [ ] REQ-NF-QUAL-004 The final design shall define how large or structured diagnostic artifacts are represented when Brute APIs support only text, images, and limited metadata in some flows.

#### Complexity
- [ ] REQ-NF-CPLX-001 Prefer the smallest viable MVP that validates extension-created sessions and inline continuation while honoring the approved maximum-diagnostics direction.
- [ ] REQ-NF-CPLX-002 Avoid introducing a second session model if existing Brute sessions can represent extension-created work.

#### Documentation
- [ ] REQ-NF-DOC-001 Document required setup for the extension, including how it connects directly to Brute and any permissions the user must grant.
- [ ] REQ-NF-DOC-002 Document project URL pattern behavior, including pattern syntax, validation, precedence, and fallback behavior.
- [ ] REQ-NF-DOC-003 Document that the diagnosis flow may capture and transmit highly sensitive page data to Brute without privacy-oriented minimization.

#### UX
- [ ] REQ-NF-UX-001 The extension must let the user trigger the main flow without manually reproducing the issue inside an agent-controlled browser.
- [ ] REQ-NF-UX-002 The project-selection UX must clearly show whether the project was auto-detected or manually chosen.
- [ ] REQ-NF-UX-003 The overlay must clearly communicate that the diagnosis flow can send a broad diagnostic bundle from the active page to Brute.
- [ ] REQ-NF-UX-004 The MVP primary UI surface shall be an in-page bottom overlay injected by the extension, not a browser-managed side panel.
- [ ] REQ-NF-UX-005 Clicking the extension icon should toggle the bottom overlay open and closed on the active page.
## Decisions
- [x] DEC-001 The extension communicates directly with the Brute HTTP API.
- [x] DEC-002 The MVP primary interaction surface is an in-page bottom overlay injected by the extension. Clicking the extension icon should toggle the overlay on the active page.
- [x] DEC-003 The product direction for the diagnosis flow is to capture as much diagnostic data as possible within the approved exclusions; privacy minimization is not a general MVP boundary.
- [x] DEC-004 The MVP scope for inline sessions is create + continue inside the extension. Full session-management parity with Caesar is not included unless later approved.
- [x] DEC-005 The MVP deployment target is a local Brute instance running on the user's machine; hosted/remote Brute connectivity is out of scope unless later approved.
- [x] DEC-006 The MVP uses no authentication between the extension and Brute, relying on local-machine trust instead.
- [x] DEC-007 Cookies and browser storage are explicitly out of scope for diagnostic capture, even in the maximum-diagnostics direction.
- [x] DEC-008 The specification and implementation scope explicitly spans coordinated changes across all three repositories: `adapter-chrome`, `caesar`, and `brute`.
- [x] DEC-009 Inline continuation uses a hybrid diagnostic-refresh model rather than initial-only capture or full recapture on every message.
- [x] DEC-007 Cookies and browser storage are explicitly out of scope for diagnostic capture, even in the maximum-diagnostics direction.
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
- [ ] Q-011 What exact hybrid refresh policy should be used during inline continuation: lightweight automatic refresh every message + explicit full recapture, refresh on page-change only, or another hybrid rule?
- [ ] Q-010 During inline continuation, should the extension attach fresh page diagnostics on every user message, only on the initial message, only on explicit recapture, or via a hybrid approach?

## Ambiguities / risks
- [ ] RISK-001 The current Caesar and Brute project models do not include URL-pattern mapping, so automatic project detection requires cross-repo schema, API, storage, and UI changes.
- [ ] RISK-002 Even with cookies/storage excluded, the approved broad-diagnostics direction means sessions may still contain highly sensitive data such as tokens in headers, request bodies, page content, screenshots, or PII, increasing exposure risk in Brute, Caesar, exports, logs, and downstream agent processing.
- [ ] RISK-003 The local/no-auth design reduces setup friction but makes any local Brute HTTP listener highly sensitive; CORS, bind address, origin allowlists, and localhost-only exposure must be defined carefully.
- [ ] RISK-004 The approved direct-to-Brute architecture still requires coordinated Caesar and Brute changes for project pattern configuration, API/storage support, and later session visibility.
- [ ] RISK-005 An injected bottom overlay can conflict with page layout, z-index, focus management, CSP restrictions, shadow DOM usage, and site-specific styling unless the implementation isolates itself carefully.
- [ ] RISK-006 Full URL pattern matching can become confusing or brittle unless the pattern syntax, validation, and precedence rules are strictly defined.
## Acceptance criteria
- [ ] AC-001 The specification explicitly defines the direct-to-local-Brute no-auth connection model, including any localhost/CORS constraints.
- [ ] AC-002 The specification explicitly defines the MVP user flows and bottom-overlay UX.
- [ ] AC-003 The specification explicitly defines the full URL pattern model, validation, precedence, and fallback behavior.
- [ ] AC-004 The specification explicitly defines the exact diagnostic bundle, the approved maximum-capture behavior, the explicit cookies/storage exclusions, and how the bundle is represented in Brute session creation and continuation flows.
- [ ] AC-005 The specification explicitly lists required changes by repository (`adapter-chrome`, `caesar`, `brute`).
- [ ] AC-006 The specification explicitly defines how extension-created sessions appear in Caesar and how they are represented in Brute metadata.
- [ ] AC-007 The specification explicitly defines the hybrid diagnostic-refresh policy used during inline continuation.
- [ ] AC-008 All open questions that block implementation are resolved or intentionally deferred with approved scope cuts.
- [ ] AC-006 The specification explicitly defines how extension-created sessions appear in Caesar and how they are represented in Brute metadata.
- [ ] AC-007 The specification explicitly defines when fresh page diagnostics are captured during inline continuation.
- [ ] AC-008 All open questions that block implementation are resolved or intentionally deferred with approved scope cuts.

## Implementation sessions
- No implementation sessions have been created yet.
