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
