import { validateBaseURL, listSpeechModels, normalizeSpeechModel } from './speech.js';
const input = document.querySelector('#url');
const modelSelect = document.querySelector('#model');
const status = document.querySelector('#status');
const saved = await chrome.storage.local.get(['baseURL', 'speechModel']);
input.value = saved.baseURL || 'http://localhost:5445';
let selectedModel = normalizeSpeechModel(saved.speechModel);

function renderModels(models) {
  if (!modelSelect) return;
  const allowed = new Set(models.map(model => model.id));
  if (!allowed.has(selectedModel)) selectedModel = 'auto';
  modelSelect.replaceChildren();
  for (const model of models) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.label;
    modelSelect.append(option);
  }
  modelSelect.value = selectedModel;
}

async function refreshModels() {
  if (!modelSelect) return;
  renderModels(await listSpeechModels(input.value));
}

await refreshModels();
document.querySelector('form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const baseURL = validateBaseURL(input.value);
    selectedModel = normalizeSpeechModel(modelSelect?.value);
    await chrome.storage.local.set({baseURL, speechModel:selectedModel});
    input.value = baseURL;
    if (status) status.textContent = 'Saved / Сохранено';
    await refreshModels();
  } catch (error) {
    if (status) status.textContent = error.message;
  }
});
