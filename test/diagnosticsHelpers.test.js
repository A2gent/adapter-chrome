const test = require('node:test');
const assert = require('node:assert/strict');

const diagnostics = require('../src/contentScript/diagnosticsHelpers.js');

const {
  latestByCapturedAt,
  endpointFromUrl,
  compactNetworkActivity,
  compactConsoleActivity,
  redactPromptEcho,
  redactPromptOccurrences,
} = diagnostics;

test('latestByCapturedAt keeps the newest records without mutating the input', () => {
  const entries = [
    { captured_at: '2026-01-01T00:00:02.000Z', id: 'middle' },
    { captured_at: '2026-01-01T00:00:03.000Z', id: 'newest' },
    { captured_at: '2026-01-01T00:00:01.000Z', id: 'oldest' },
  ];

  assert.deepEqual(latestByCapturedAt(entries, 2), [
    { captured_at: '2026-01-01T00:00:02.000Z', id: 'middle' },
    { captured_at: '2026-01-01T00:00:03.000Z', id: 'newest' },
  ]);
  assert.deepEqual(entries.map((entry) => entry.id), ['middle', 'newest', 'oldest']);
  assert.deepEqual(latestByCapturedAt(null, 2), []);
});

test('endpointFromUrl strips query and fragment noise while keeping endpoint identity', () => {
  assert.equal(
    endpointFromUrl('https://example.com/path/to/resource?token=secret#part'),
    'https://example.com/path/to/resource',
  );
  assert.equal(endpointFromUrl('data:text/plain;base64,abcd'), 'data:[omitted]');
  assert.equal(endpointFromUrl('blob:https://example.com/1234'), 'blob:[omitted]');
  assert.equal(endpointFromUrl('/relative/path?x=1#y'), 'http://localhost/relative/path');
  assert.equal(endpointFromUrl('http://%zz/path?token=secret#fragment'), 'http://%zz/path');
  assert.equal(endpointFromUrl(''), '');
});

test('compactNetworkActivity keeps newest endpoint records and omits heavy request details', () => {
  const entries = [
    {
      method: 'POST',
      url: 'https://example.com/api/items?token=secret',
      status: 201,
      ok: true,
      content_type: 'application/json',
      duration_ms: 123,
      captured_at: '2026-01-01T00:00:01.000Z',
      request_headers: { authorization: 'secret' },
      request_body: '{"secret":true}',
      response_body_preview: '{"id":1}',
    },
    {
      method: 'GET',
      url: 'https://example.com/assets/app.js?v=2',
      status: 200,
      ok: true,
      content_type: 'application/javascript',
      duration_ms: 45,
      captured_at: '2026-01-01T00:00:02.000Z',
    },
  ];

  assert.deepEqual(compactNetworkActivity(entries, 20), [
    {
      method: 'GET',
      endpoint: 'https://example.com/assets/app.js',
      status: 200,
      ok: true,
      content_type: 'application/javascript',
      duration_ms: 45,
      captured_at: '2026-01-01T00:00:02.000Z',
    },
    {
      method: 'POST',
      endpoint: 'https://example.com/api/items',
      status: 201,
      ok: true,
      content_type: 'application/json',
      duration_ms: 123,
      captured_at: '2026-01-01T00:00:01.000Z',
    },
  ]);
});

test('compactNetworkActivity includes bounded optional failure metadata', () => {
  const now = () => '2026-01-01T00:00:04.000Z';
  const longStatus = 'Gateway timeout while upstream was unavailable. '.repeat(8);
  const longError = 'NetworkError: failed to fetch secret-bearing resource. '.repeat(20);

  const [record] = compactNetworkActivity([
    {
      method: 'patch',
      url: 'https://example.com/api/fail?token=secret#debug',
      status: 504,
      ok: false,
      type: 'fetch',
      content_type: 'text/plain; charset=utf-8',
      status_text: longStatus,
      duration_ms: 12.7,
      error_message: longError,
    },
  ], 20, now);

  assert.deepEqual(record, {
    captured_at: '2026-01-01T00:00:04.000Z',
    method: 'PATCH',
    endpoint: 'https://example.com/api/fail',
    status: 504,
    ok: false,
    type: 'fetch',
    content_type: 'text/plain; charset=utf-8',
    status_text: `${longStatus.slice(0, 160)}…[truncated]`,
    duration_ms: 13,
    error_message: `${longError.slice(0, 500)}…[truncated]`,
  });
});

test('compactConsoleActivity removes repeated prompt echoes from automatic diagnostics', () => {
  const userPrompt = 'for races, lets create custom component that allows to have a drop-down like select, but also allows to write free text';
  const entries = [
    { captured_at: '2026-01-01T00:00:01.000Z', level: 'log', args: [userPrompt.slice(0, 60)] },
    { captured_at: '2026-01-01T00:00:02.000Z', level: 'log', args: [userPrompt.slice(0, 90)] },
    { captured_at: '2026-01-01T00:00:03.000Z', level: 'warn', args: ['real warning'] },
    { captured_at: '2026-01-01T00:00:04.000Z', level: 'warn', args: ['real warning'] },
  ];

  assert.deepEqual(compactConsoleActivity(entries, 20, userPrompt), [
    { captured_at: '2026-01-01T00:00:04.000Z', level: 'warn', message: 'real warning', repeat_count: 2 },
    { captured_at: '2026-01-01T00:00:02.000Z', level: 'log', message: '[user prompt echo omitted]', repeat_count: 2 },
  ]);
});

test('prompt redaction helpers omit prompt echoes from captured page text', () => {
  const prompt = 'Please build a custom race selector with free text input support';

  assert.equal(redactPromptEcho(`  ${prompt}  `, prompt), '[user prompt echo omitted]');
  assert.equal(
    redactPromptOccurrences(`Before ${prompt} after ${prompt}`, prompt),
    'Before [user prompt omitted] after [user prompt omitted]',
  );
});
