export function validateBaseURL(raw = 'http://localhost:5445') {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use a local Brute origin, e.g. http://localhost:5445');
  }
  return url.origin;
}

export function normalizeSpeechModel(raw) {
  const model = typeof raw === 'string' ? raw.trim() : '';
  return model && model !== 'auto' ? model : 'auto';
}

export function speechModelsFromResponse(payload) {
  const models = Array.isArray(payload?.models) ? payload.models : [];
  const out = [{id:'auto', label:'Auto (best available) / Авто (лучший доступный)', available:true}];
  const seen = new Set(['auto']);
  for (const model of models) {
    const id = typeof model?.id === 'string' ? model.id.trim() : '';
    if (!id || seen.has(id) || model.available === false) continue;
    seen.add(id);
    out.push({
      id,
      label: typeof model.label === 'string' && model.label.trim() ? model.label.trim() : id,
      engine: typeof model.engine === 'string' ? model.engine : '',
      languages: Array.isArray(model.languages) ? model.languages : [],
      available:true,
    });
  }
  return out;
}

export async function listSpeechModels(baseURL, fetcher = fetch) {
  try {
    const response = await fetcher(`${validateBaseURL(baseURL)}/speech/models`, {
      method:'GET', headers:{Accept:'application/json'}, credentials:'omit', redirect:'error',
      signal:AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Speech models HTTP ${response.status}`);
    return speechModelsFromResponse(await response.json());
  } catch {
    // Old Brute builds have no catalog; keep Auto so playback still works.
    return speechModelsFromResponse({models:[]});
  }
}

export async function synthesize({text, language = 'en', model = 'auto', baseURL, signal}, fetcher = fetch) {
  if (typeof text !== 'string' || !text.trim() || text.length > 60000) throw new Error('Invalid text (1-60000 characters).');
  if (!['ru', 'en'].includes(language)) throw new Error('Unsupported language.');
  const timeout = AbortSignal.timeout(240000);
  // Brute treats an omitted model as its configured single engine, not its Auto fallback chain.
  const body = {text, language, model:normalizeSpeechModel(model)};
  const response = await fetcher(`${validateBaseURL(baseURL)}/speech/completion`, {
    method:'POST', headers:{'Content-Type':'application/json', Accept:'audio/*'},
    body:JSON.stringify(body), credentials:'omit', redirect:'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`Speech API HTTP ${response.status}. Check Brute TTS configuration.`);
  const type = response.headers.get('content-type')?.split(';')[0];
  if (!type?.startsWith('audio/')) throw new Error('Speech API did not return audio.');
  // Bound memory even when the server omits Content-Length.
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024 * 1024) throw new Error('Audio exceeds 64 MiB.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  if (!size) throw new Error('Speech API returned empty audio.');
  return new Blob(chunks, {type});
}
