const test = require('node:test');
const assert = require('node:assert/strict');

const diagnostics = require('../src/contentScript/diagnosticsHelpers.js');

const { endpointFromUrl, compactNetworkActivity } = diagnostics;

test('endpointFromUrl strips query and fragment noise while keeping endpoint identity', () => {
  assert.equal(
    endpointFromUrl('https://example.com/path/to/resource?token=secret#part'),
    'https://example.com/path/to/resource',
  );
  assert.equal(endpointFromUrl('data:text/plain;base64,abcd'), 'data:[omitted]');
  assert.equal(endpointFromUrl('blob:https://example.com/1234'), 'blob:[omitted]');
  assert.equal(endpointFromUrl('/relative/path?x=1#y'), 'http://localhost/relative/path');
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
