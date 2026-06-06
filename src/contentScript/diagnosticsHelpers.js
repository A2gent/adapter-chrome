((root, factory) => {
  const shared = root?.__A2GENT_CONTENT_SCRIPT_SHARED__;
  const exported = factory(shared || require('./shared.js'));
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.__A2GENT_CONTENT_SCRIPT_DIAGNOSTICS__ = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, (shared) => {
  const latestByCapturedAt = (entries, limit) => (Array.isArray(entries) ? entries : [])
    .slice()
    .sort((a, b) => (Date.parse(a?.captured_at || '') || 0) - (Date.parse(b?.captured_at || '') || 0))
    .slice(-(Number(limit) || shared.MAX_NETWORK_ENTRIES));

  const endpointFromUrl = (value, baseHref = 'http://localhost/') => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw, baseHref);
      // WHY: diagnostic network payloads were overwhelming model context.
      // WHAT: keep endpoint identity while dropping query/fragment/body/header data.
      if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') {
        return `${parsed.protocol}[omitted]`;
      }
      if (parsed.origin && parsed.origin !== 'null') {
        return `${parsed.origin}${parsed.pathname || '/'}`;
      }
      return `${parsed.protocol}${parsed.pathname || ''}`;
    } catch {
      return raw.replace(/[?#].*$/, '');
    }
  };

  const compactNetworkActivity = (entries, maxEntries = shared.MAX_NETWORK_ENTRIES, now = shared.nowIso, baseHref = 'http://localhost/') => latestByCapturedAt(entries, maxEntries)
    .reverse()
    .map((entry) => {
      const out = {
        captured_at: entry?.captured_at || now(),
        method: String(entry?.method || 'GET').toUpperCase(),
        endpoint: endpointFromUrl(entry?.url, baseHref),
      };
      const status = Number(entry?.status);
      if (Number.isFinite(status)) {
        out.status = status;
      }
      if (typeof entry?.ok === 'boolean') {
        out.ok = entry.ok;
      }
      if (entry?.type && entry.type !== 'network') {
        out.type = entry.type;
      }
      if (entry?.content_type) {
        out.content_type = shared.clip(entry.content_type, 160);
      }
      if (entry?.status_text) {
        out.status_text = shared.clip(entry.status_text, 160);
      }
      const durationMs = Number(entry?.duration_ms);
      if (Number.isFinite(durationMs)) {
        out.duration_ms = Math.round(durationMs);
      }
      if (entry?.error_message || entry?.error) {
        out.error_message = shared.clip(entry.error_message || entry.error, 500);
      }
      return out;
    });

  return {
    latestByCapturedAt,
    endpointFromUrl,
    compactNetworkActivity,
  };
});
