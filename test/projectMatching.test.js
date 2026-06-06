const test = require('node:test');
const assert = require('node:assert/strict');

const projectMatching = require('../src/contentScript/projectMatching.js');

const {
  wildcardCount,
  literalCharCount,
  literalPathLength,
  patternMatchesUrl,
  detectProject,
} = projectMatching;

test('pattern scoring prefers fewer wildcards, then more literal characters, then longer literal path', () => {
  assert.equal(wildcardCount('https://example.com/*'), 1);
  assert.equal(literalCharCount('https://example.com/*'), 'https://example.com/'.length);
  assert.equal(literalPathLength('https://example.com/path/*'), '/path/'.length);
});

test('patternMatchesUrl supports absolute wildcard URL patterns', () => {
  assert.equal(patternMatchesUrl('https://example.com/issues/*', 'https://example.com/issues/123'), true);
  assert.equal(patternMatchesUrl('https://example.com/issues/*', 'https://example.com/pulls/123'), false);
  assert.equal(patternMatchesUrl('https://*.example.com/*', 'https://app.example.com/dashboard'), true);
});

test('detectProject auto-selects the uniquely most specific project', () => {
  const projects = [
    { id: 'fallback', name: 'Fallback', url_patterns: ['https://example.com/*'] },
    { id: 'issues', name: 'Issues', url_patterns: ['https://example.com/issues/*'] },
    { id: 'literal', name: 'Literal', url_patterns: ['https://example.com/issues/123'] },
  ];

  assert.deepEqual(detectProject(projects, 'https://example.com/issues/123'), {
    projectId: 'literal',
    mode: 'auto',
    label: 'Auto-detected: Literal',
    detail: 'Matched https://example.com/issues/123',
  });
});

test('detectProject falls back to manual selection when no pattern matches', () => {
  const result = detectProject([{ id: 'one', name: 'One', url_patterns: ['https://example.com/*'] }], 'https://other.test/');

  assert.deepEqual(result, {
    projectId: '',
    mode: 'manual',
    label: 'Manual selection',
    detail: 'No URL pattern matched this page.',
  });
});

test('detectProject requires manual selection when different projects tie equally', () => {
  const result = detectProject([
    { id: 'alpha', name: 'Alpha', url_patterns: ['https://example.com/*'] },
    { id: 'beta', name: 'Beta', url_patterns: ['https://example.com/*'] },
  ], 'https://example.com/page');

  assert.equal(result.projectId, '');
  assert.equal(result.mode, 'manual');
  assert.equal(result.label, 'Manual selection required');
  assert.match(result.detail, /Alpha/);
  assert.match(result.detail, /Beta/);
});
