export const queryKeys = {
  personas: {
    all: ['personas'] as const,
    list: () => [...queryKeys.personas.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.personas.all, 'detail', id] as const,
  },
  lore: {
    all: ['lore'] as const,
    list: () => [...queryKeys.lore.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.lore.all, 'detail', id] as const,
  },
  sessions: {
    all: ['sessions'] as const,
    list: () => [...queryKeys.sessions.all, 'list'] as const,
    transcript: (id: string) => [...queryKeys.sessions.all, 'transcript', id] as const,
    memory: (id: string) => [...queryKeys.sessions.all, 'memory', id] as const,
  },
  agents: {
    all: ['agents'] as const,
    list: () => [...queryKeys.agents.all, 'list'] as const,
  },
  jobs: {
    all: ['jobs'] as const,
    list: () => [...queryKeys.jobs.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.jobs.all, 'detail', id] as const,
  },
  providers: {
    all: ['providers'] as const,
    list: () => [...queryKeys.providers.all, 'list'] as const,
  },
  runtime: {
    all: ['runtime'] as const,
    snapshot: () => [...queryKeys.runtime.all, 'snapshot'] as const,
  },
  state: {
    all: ['state'] as const,
    snapshot: (sessionId?: string) => [...queryKeys.state.all, 'snapshot', sessionId] as const,
    maidenDecisions: (sessionId?: string) =>
      [...queryKeys.state.all, 'maiden-decisions', sessionId] as const,
  },
  requests: {
    all: ['requests'] as const,
    summary: (id: string) => [...queryKeys.requests.all, 'summary', id] as const,
    prompt: (id: string) => [...queryKeys.requests.all, 'prompt', id] as const,
    chunks: (id: string) => [...queryKeys.requests.all, 'chunks', id] as const,
    diagnose: (id: string) => [...queryKeys.requests.all, 'diagnose', id] as const,
    trace: (id: string) => [...queryKeys.requests.all, 'trace', id] as const,
    retrievalTrace: (id: string) => [...queryKeys.requests.all, 'retrieval-trace', id] as const,
    logs: () => [...queryKeys.requests.all, 'logs'] as const,
  },
  memory: {
    all: ['memory'] as const,
    coreBlocks: (agentId: string) => [...queryKeys.memory.all, 'core-blocks', agentId] as const,
    pinnedSummaries: (agentId: string) =>
      [...queryKeys.memory.all, 'pinned-summaries', agentId] as const,
    episodes: (agentId: string) => [...queryKeys.memory.all, 'episodes', agentId] as const,
    narratives: (agentId: string) => [...queryKeys.memory.all, 'narratives', agentId] as const,
    settlements: (agentId: string) => [...queryKeys.memory.all, 'settlements', agentId] as const,
  },
  study: {
    all: ['study'] as const,
    recentRequests: (agentId: string) =>
      [...queryKeys.study.all, 'recent-requests', agentId] as const,
  },
  cognition: {
    all: ['cognition'] as const,
    assertions: (agentId: string, params?: Record<string, unknown>) =>
      [...queryKeys.cognition.all, 'assertions', agentId, params] as const,
    evaluations: (agentId: string, params?: Record<string, unknown>) =>
      [...queryKeys.cognition.all, 'evaluations', agentId, params] as const,
    commitments: (agentId: string, params?: Record<string, unknown>) =>
      [...queryKeys.cognition.all, 'commitments', agentId, params] as const,
    history: (agentId: string, key: string) =>
      [...queryKeys.cognition.all, 'history', agentId, key] as const,
  },
  graph: {
    all: ['graph'] as const,
    nodes: (agentId: string, params?: Record<string, unknown>) =>
      [...queryKeys.graph.all, 'nodes', agentId, params] as const,
    nodeDetail: (agentId: string, nodeRef: string) =>
      [...queryKeys.graph.all, 'node-detail', agentId, nodeRef] as const,
    nodeEdges: (agentId: string, nodeRef: string, params?: Record<string, unknown>) =>
      [...queryKeys.graph.all, 'node-edges', agentId, nodeRef, params] as const,
  },
  health: {
    healthz: ['healthz'] as const,
    readyz: ['readyz'] as const,
  },
} as const
