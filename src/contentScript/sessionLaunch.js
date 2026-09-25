((root, factory) => {
  const exported = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.__A2GENT_CONTENT_SCRIPT_SESSION_LAUNCH__ = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const BUILT_IN_HOST_AGENT_ID = 'builtin:host-agent';

  const createBuiltInHostAgent = () => ({
    id: BUILT_IN_HOST_AGENT_ID,
    name: 'Built-in agent on host',
    runtime: 'host',
  });

  const isBuiltInHostAgent = (agent) => agent?.id === BUILT_IN_HOST_AGENT_ID;

  const isModellessProvider = (type) => {
    const providerType = String(type || '');
    return providerType === 'automatic_router' || providerType === 'fallback_chain' || providerType.startsWith('fallback_chain:');
  };

  const isLaunchableDockerAgent = (agent) => (
    Boolean(agent?.id) && agent.id !== BUILT_IN_HOST_AGENT_ID && agent.runtime === 'docker'
  );

  const resolvedProjectId = (agent) => (
    agent?.project_id
    || agent?.sub_agent?.project_id
    || agent?.definition?.local?.project_bindings?.configured_project
    || ''
  ).trim();

  const isGlobalScopedAgent = (agent) => resolvedProjectId(agent) === '';

  const buildAgentOptions = ({ globalAgents = [], projectAgents = [], projectId = '' } = {}) => {
    const options = [createBuiltInHostAgent()];
    const seen = new Set([BUILT_IN_HOST_AGENT_ID]);
    const add = (agent) => {
      if (!isLaunchableDockerAgent(agent) || seen.has(agent.id)) return;
      seen.add(agent.id);
      options.push(agent);
    };
    const selectedProjectId = String(projectId || '').trim();
    for (const agent of projectAgents) {
      if (selectedProjectId && resolvedProjectId(agent) === selectedProjectId) add(agent);
    }
    for (const agent of globalAgents) {
      if (isGlobalScopedAgent(agent)) add(agent);
    }
    return options;
  };

  const resolveSelectedAgent = (agents, selectedAgentId) => {
    const list = Array.isArray(agents) && agents.length > 0 ? agents : [createBuiltInHostAgent()];
    return list.find((agent) => agent.id === selectedAgentId) || list[0];
  };

  const resolveSelectedProvider = (providers, selectedProvider) => {
    const list = Array.isArray(providers) ? providers : [];
    if (selectedProvider && list.some((provider) => provider.type === selectedProvider)) {
      return selectedProvider;
    }
    return list.find((provider) => provider?.is_active === true)?.type || list[0]?.type || '';
  };

  const uniqueModels = (values) => {
    const out = [];
    const seen = new Set();
    for (const value of values) {
      const model = String(value || '').trim();
      if (!model || seen.has(model)) continue;
      seen.add(model);
      out.push(model);
    }
    return out;
  };

  const resolveSelectedModel = (provider, models, selectedModel, { reset = false } = {}) => {
    const catalog = Array.isArray(models) ? models.filter(Boolean) : [];
    const preferred = reset ? [] : [selectedModel];
    const candidates = uniqueModels([
      ...preferred,
      provider?.model,
      provider?.default_model,
      ...catalog,
    ]);
    if (catalog.length === 0) return candidates[0] || '';
    return candidates.find((model) => catalog.includes(model)) || catalog[0] || '';
  };

  const normalizeModelsResponse = (body, provider) => {
    const fromBody = Array.isArray(body?.models)
      ? body.models
      : Array.isArray(body?.data)
        ? body.data.map((item) => (typeof item === 'string' ? item : item?.id))
        : Array.isArray(body) ? body : [];
    return uniqueModels([provider?.model, provider?.default_model, ...fromBody]);
  };

  const modelsPathForProvider = (type) => {
    const providerType = String(type || '').trim();
    if (!providerType || isModellessProvider(providerType)) return '';
    if (providerType.startsWith('anthropic:')) return '/providers/anthropic/models';
    return `/providers/${encodeURIComponent(providerType)}/models`;
  };

  const shouldShowProviderControls = (agent) => isBuiltInHostAgent(agent) || !agent;

  const buildSessionRequest = ({
    agent,
    provider,
    model,
    projectId,
    metadata,
    task,
    images,
  } = {}) => {
    if (!agent) {
      throw new Error('Select an agent first.');
    }
    const imageList = Array.isArray(images) ? images : [];
    const payload = {
      agent_id: 'build',
      queued: true,
      queue_mode: 'serial',
      metadata: {
        ...(metadata || {}),
        launch_target: 'agent',
        launch_agent_id: agent.id,
        launch_agent_name: agent.name,
        launch_agent_runtime: agent.runtime,
      },
    };
    if (projectId) payload.project_id = projectId;
    if (typeof task === 'string' && task.trim()) payload.task = task;
    if (imageList.length > 0) payload.images = imageList;
    if (isBuiltInHostAgent(agent)) {
      if (provider) payload.provider = provider;
      if (model) payload.model = model;
      return payload;
    }
    const rawDockerOnly = Boolean(agent.docker_agent) && !agent.definition && !agent.sub_agent && !agent.managed;
    if (rawDockerOnly) payload.docker_agent_id = agent.id;
    else payload.unified_agent_id = agent.id;
    return payload;
  };

  return {
    BUILT_IN_HOST_AGENT_ID,
    createBuiltInHostAgent,
    isBuiltInHostAgent,
    isModellessProvider,
    isLaunchableDockerAgent,
    isGlobalScopedAgent,
    resolvedProjectId,
    buildAgentOptions,
    resolveSelectedAgent,
    resolveSelectedProvider,
    resolveSelectedModel,
    normalizeModelsResponse,
    modelsPathForProvider,
    shouldShowProviderControls,
    buildSessionRequest,
  };
});
