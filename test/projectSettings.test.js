const test = require('node:test');
const assert = require('node:assert/strict');

const projectSettings = require('../src/contentScript/projectSettings.js');
const sessionLaunch = require('../src/contentScript/sessionLaunch.js');
const shared = require('../src/contentScript/shared.js');

const withChrome = (t, chromeMock) => {
  const previousChrome = global.chrome;
  const previousLocation = global.location;
  global.chrome = chromeMock;
  global.location = { href: 'https://app.example.test/billing' };
  t.after(() => {
    if (previousChrome === undefined) delete global.chrome;
    else global.chrome = previousChrome;
    global.location = previousLocation;
  });
};

const createStateBox = (initial = {}) => {
  let state = {
    baseUrl: shared.DEFAULT_BRUTE_BASE_URL,
    projects: [],
    selectedProjectId: '',
    providers: [],
    models: [],
    agents: [],
    selectedProvider: '',
    selectedModel: '',
    selectedAgentId: '',
    ...initial,
  };
  return {
    getState: () => state,
    setRawState: (next) => { state = next; },
    setState: (patch) => { state = { ...state, ...patch }; },
    render() {},
  };
};

test('loadSettingsAndProjects hydrates project, provider, model, and host agent defaults', async (t) => {
  const stored = {};
  withChrome(t, {
    storage: {
      local: {
        get(keys, callback) {
          const key = Array.isArray(keys) ? keys[0] : keys;
          callback({ [key]: stored[key] });
        },
        set(payload, callback) {
          Object.assign(stored, payload);
          callback();
        },
      },
    },
  });

  const box = createStateBox();
  await projectSettings.loadSettingsAndProjects({
    ...box,
    listProjects: async () => [{ id: 'proj-1', name: 'Billing', url_patterns: ['https://app.example.test/*'] }],
    listProviders: async () => ([
      { type: 'openai_codex', display_name: 'OpenAI Codex', is_active: true, model: 'gpt-5.5', default_model: 'gpt-5.4' },
      { type: 'cursor', display_name: 'Cursor', is_active: false, model: 'composer-2', default_model: 'composer-2' },
    ]),
    listUnifiedAgents: async (projectId = '') => (
      projectId
        ? [{ id: 'reviewer', name: 'Reviewer', runtime: 'docker', project_id: projectId }]
        : [{ id: 'researcher', name: 'Researcher', runtime: 'docker' }]
    ),
    listProviderModels: async (provider) => sessionLaunch.normalizeModelsResponse({ models: ['gpt-5.6', 'gpt-5.5'] }, provider),
  });

  const state = box.getState();
  assert.equal(state.selectedProjectId, 'proj-1');
  assert.equal(state.selectedProvider, 'openai_codex');
  assert.equal(state.selectedModel, 'gpt-5.5');
  assert.equal(state.selectedAgentId, sessionLaunch.BUILT_IN_HOST_AGENT_ID);
  assert.deepEqual(state.models, ['gpt-5.5', 'gpt-5.4', 'gpt-5.6']);
  assert.deepEqual(state.agents.map((agent) => agent.id), [
    sessionLaunch.BUILT_IN_HOST_AGENT_ID,
    'reviewer',
    'researcher',
  ]);
  assert.deepEqual(stored[shared.STORAGE_SESSION_LAUNCH_KEY], {
    provider: 'openai_codex',
    model: 'gpt-5.5',
    agentId: sessionLaunch.BUILT_IN_HOST_AGENT_ID,
  });
});

test('provider and agent changes persist launch prefs and hide models for docker agents', async (t) => {
  const stored = {};
  withChrome(t, {
    storage: {
      local: {
        get(keys, callback) {
          const key = Array.isArray(keys) ? keys[0] : keys;
          callback({ [key]: stored[key] });
        },
        set(payload, callback) {
          Object.assign(stored, payload);
          callback();
        },
      },
    },
  });

  const box = createStateBox({
    providers: [
      { type: 'cursor', display_name: 'Cursor', is_active: true, model: 'composer-2', default_model: 'composer-1' },
    ],
    agents: [
      sessionLaunch.createBuiltInHostAgent(),
      { id: 'reviewer', name: 'Reviewer', runtime: 'docker' },
    ],
    selectedAgentId: sessionLaunch.BUILT_IN_HOST_AGENT_ID,
    selectedProvider: 'cursor',
    selectedModel: 'composer-1',
  });

  await projectSettings.changeProvider({
    ...box,
    providerType: 'cursor',
    listProviderModels: async () => ['composer-2', 'composer-1'],
  });
  assert.equal(box.getState().selectedModel, 'composer-2');

  await projectSettings.changeAgent({
    ...box,
    agentId: 'reviewer',
  });
  assert.equal(box.getState().selectedAgentId, 'reviewer');
  assert.deepEqual(box.getState().models, []);
  assert.deepEqual(stored[shared.STORAGE_SESSION_LAUNCH_KEY], {
    provider: 'cursor',
    model: 'composer-2',
    agentId: 'reviewer',
  });
});
