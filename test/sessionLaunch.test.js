const test = require('node:test');
const assert = require('node:assert/strict');

const sessionLaunch = require('../src/contentScript/sessionLaunch.js');

test('built-in host agent is always first in launch options', () => {
  const options = sessionLaunch.buildAgentOptions({
    globalAgents: [{ id: 'global-1', name: 'Researcher', runtime: 'docker' }],
    projectAgents: [{ id: 'project-1', name: 'Reviewer', runtime: 'docker', project_id: 'proj-1' }],
    projectId: 'proj-1',
  });

  assert.equal(options[0].id, sessionLaunch.BUILT_IN_HOST_AGENT_ID);
  assert.equal(options[0].runtime, 'host');
  assert.deepEqual(options.map((agent) => agent.id), [
    sessionLaunch.BUILT_IN_HOST_AGENT_ID,
    'project-1',
    'global-1',
  ]);
});

test('agent options ignore non-docker catalog entries and keep only scoped project agents', () => {
  const options = sessionLaunch.buildAgentOptions({
    globalAgents: [
      { id: 'host-copy', name: 'Other host', runtime: 'host' },
      { id: 'global-1', name: 'Global docker', runtime: 'docker' },
    ],
    projectAgents: [
      { id: 'other-project', name: 'Other project', runtime: 'docker', project_id: 'proj-2' },
      { id: 'project-1', name: 'This project', runtime: 'docker', project_id: 'proj-1' },
    ],
    projectId: 'proj-1',
  });

  assert.deepEqual(options.map((agent) => agent.id), [
    sessionLaunch.BUILT_IN_HOST_AGENT_ID,
    'project-1',
    'global-1',
  ]);
});

test('resolve helpers fall back to active provider, saved model, and host agent', () => {
  const providers = [
    { type: 'openai_codex', is_active: false, model: 'gpt-5.5', default_model: 'gpt-5.4' },
    { type: 'cursor', is_active: true, model: 'composer-2', default_model: 'composer-2' },
  ];
  const agents = sessionLaunch.buildAgentOptions({ globalAgents: [], projectAgents: [], projectId: '' });

  assert.equal(sessionLaunch.resolveSelectedProvider(providers, 'missing'), 'cursor');
  assert.equal(sessionLaunch.resolveSelectedProvider(providers, 'openai_codex'), 'openai_codex');
  assert.equal(sessionLaunch.resolveSelectedModel(providers[0], ['gpt-5.6', 'gpt-5.5'], ''), 'gpt-5.5');
  assert.equal(sessionLaunch.resolveSelectedModel(providers[0], ['gpt-5.6'], 'gpt-5.6'), 'gpt-5.6');
  assert.equal(sessionLaunch.resolveSelectedAgent(agents, '').id, sessionLaunch.BUILT_IN_HOST_AGENT_ID);
});

test('host launch request keeps provider and model, docker agents use their target id', () => {
  const host = sessionLaunch.createBuiltInHostAgent();
  const docker = {
    id: 'reviewer',
    name: 'Reviewer',
    runtime: 'docker',
    definition: { id: 'reviewer' },
  };
  const rawDocker = {
    id: 'container-1',
    name: 'Raw container',
    runtime: 'docker',
    docker_agent: { id: 'container-1' },
  };

  assert.deepEqual(sessionLaunch.buildSessionRequest({
    agent: host,
    provider: 'cursor',
    model: 'composer-2',
    projectId: 'proj-1',
    task: 'Inspect the page',
    images: [{ name: 'screen.png' }],
    metadata: { source: 'adapter-chrome' },
  }), {
    agent_id: 'build',
    project_id: 'proj-1',
    provider: 'cursor',
    model: 'composer-2',
    task: 'Inspect the page',
    images: [{ name: 'screen.png' }],
    queued: true,
    queue_mode: 'serial',
    metadata: {
      source: 'adapter-chrome',
      launch_target: 'agent',
      launch_agent_id: sessionLaunch.BUILT_IN_HOST_AGENT_ID,
      launch_agent_name: 'Built-in agent on host',
      launch_agent_runtime: 'host',
    },
  });

  assert.deepEqual(sessionLaunch.buildSessionRequest({
    agent: docker,
    projectId: 'proj-1',
    metadata: { source: 'adapter-chrome' },
  }), {
    agent_id: 'build',
    project_id: 'proj-1',
    unified_agent_id: 'reviewer',
    queued: true,
    queue_mode: 'serial',
    metadata: {
      source: 'adapter-chrome',
      launch_target: 'agent',
      launch_agent_id: 'reviewer',
      launch_agent_name: 'Reviewer',
      launch_agent_runtime: 'docker',
    },
  });

  assert.equal(sessionLaunch.buildSessionRequest({ agent: rawDocker, metadata: {} }).docker_agent_id, 'container-1');
  assert.equal(sessionLaunch.shouldShowProviderControls(host), true);
  assert.equal(sessionLaunch.shouldShowProviderControls(docker), false);
});

test('model catalog helpers normalize API shapes and skip modelless providers', () => {
  assert.equal(sessionLaunch.modelsPathForProvider('openai_codex'), '/providers/openai_codex/models');
  assert.equal(sessionLaunch.modelsPathForProvider('anthropic:work'), '/providers/anthropic/models');
  assert.equal(sessionLaunch.modelsPathForProvider('automatic_router'), '');
  assert.deepEqual(
    sessionLaunch.normalizeModelsResponse({ models: ['gpt-5.6', 'gpt-5.5'] }, { model: 'gpt-5.5' }),
    ['gpt-5.5', 'gpt-5.6'],
  );
  assert.deepEqual(
    sessionLaunch.normalizeModelsResponse({ data: [{ id: 'composer-2' }] }, { default_model: 'composer-1' }),
    ['composer-1', 'composer-2'],
  );
});
