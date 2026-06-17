const test = require('node:test');
const assert = require('node:assert/strict');

const { renderOverlay } = require('../src/contentUi.js');

const baseState = (overrides = {}) => ({
  baseUrl: 'http://localhost:5445',
  busy: false,
  drawingEnabled: false,
  error: '',
  followup: '',
  hasDrawing: false,
  messages: [],
  projectDetection: { mode: 'default', label: 'Default project', detail: '' },
  projects: [],
  prompt: '',
  recapturing: false,
  selectedProjectId: '',
  sessionId: '',
  settingsOpen: false,
  status: 'Ready',
  ...overrides,
});

test('draw focus action renders in header before settings', () => {
  const html = renderOverlay({
    state: baseState(),
    compactOverlayHeight: 160,
    compactOverlayMinHeight: 120,
    expandedOverlayMinHeight: 360,
  });

  const drawIndex = html.indexOf('data-role="drawing-toggle"');
  const settingsIndex = html.indexOf('data-role="settings-toggle"');
  const composerIndex = html.indexOf('class="create-composer"');

  assert.notEqual(drawIndex, -1);
  assert.ok(drawIndex < settingsIndex, 'Draw focus should sit next to Settings in the header');
  assert.ok(settingsIndex < composerIndex, 'Header actions should render above the composer textarea');
  assert.doesNotMatch(html, /class="drawing-tools"/);
});

test('drawing header reflects active drawing state and disables cancellation while busy', () => {
  const html = renderOverlay({
    state: baseState({ busy: true, drawingEnabled: true, hasDrawing: true }),
    compactOverlayHeight: 160,
    compactOverlayMinHeight: 120,
    expandedOverlayMinHeight: 360,
  });

  assert.match(html, /data-role="drawing-toggle"[\s\S]*class="ghost active-drawing"[\s\S]*aria-pressed="true"[\s\S]*disabled[\s\S]*>Done drawing<\/button>/);
  assert.match(html, /data-role="drawing-cancel"[\s\S]*disabled>Cancel drawing<\/button>/);
});

test('settings panel renders escaped project controls when explicitly opened', () => {
  const html = renderOverlay({
    state: baseState({
      baseUrl: 'http://localhost:5445/?x=<script>',
      projectDetection: { mode: 'auto', label: 'Matched <repo>', detail: '' },
      projects: [
        { id: 'project-1', name: 'Safe project' },
        { id: 'project-<2>', name: 'Important <Project>' },
      ],
      selectedProjectId: 'project-<2>',
      settingsOpen: true,
    }),
    compactOverlayHeight: 160,
    compactOverlayMinHeight: 120,
    expandedOverlayMinHeight: 360,
  });

  assert.match(html, /<section class="settings-panel" aria-label="Adapter settings">/);
  assert.match(html, /data-role="settings-toggle"[\s\S]*aria-expanded="true"[\s\S]*Hide settings/);
  assert.match(html, /value="http:\/\/localhost:5445\/\?x=&lt;script&gt;"/);
  assert.match(html, /<option value="project-&lt;2&gt;" selected>Important &lt;Project&gt;<\/option>/);
  assert.match(html, /<div class="detection auto">[\s\S]*<strong>Matched &lt;repo&gt;<\/strong>[\s\S]*<span>Important &lt;Project&gt;<\/span>/);
  assert.doesNotMatch(html, /<script>|<repo>|<Project>/);
});

test('existing session view renders escaped inline messages and follow-up actions', () => {
  const html = renderOverlay({
    state: baseState({
      busy: true,
      followup: 'Use <details> next',
      messages: [
        { role: 'user', content: 'Problem: <button>broken</button>' },
        { role: 'assistant', content: 'Try "safe" & continue' },
      ],
      recapturing: true,
      sessionId: 'session-1',
    }),
    compactOverlayHeight: 160,
    compactOverlayMinHeight: 120,
    expandedOverlayMinHeight: 360,
  });

  assert.match(html, /<div class="panel has-session/);
  assert.match(html, /<section class="messages">[\s\S]*<div class="message user">[\s\S]*Problem: &lt;button&gt;broken&lt;\/button&gt;/);
  assert.match(html, /<div class="message assistant">[\s\S]*Try &quot;safe&quot; &amp; continue/);
  assert.match(html, /<textarea data-role="followup"[^>]*>Use &lt;details&gt; next<\/textarea>/);
  assert.match(html, /data-role="recapture"[\s\S]*disabled[\s\S]*Recapturing\.\.\./);
  assert.match(html, /data-role="send"[\s\S]*disabled>Send<\/button>/);
  assert.doesNotMatch(html, /<button>broken|<details>/);
});
