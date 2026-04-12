import type {
  CoreMemoryBlockList,
  PinnedSummaryList,
  EpisodeList,
  NarrativeList,
  SettlementList,
} from '../contracts'
import { apiFetch } from './client'

export function listCoreMemoryBlocks(agentId: string): Promise<CoreMemoryBlockList> {
  return apiFetch<CoreMemoryBlockList>(`/v1/agents/${agentId}/memory/core-blocks`)
}

export function getCoreMemoryBlock(agentId: string, label: string): Promise<unknown> {
  return apiFetch(`/v1/agents/${agentId}/memory/core-blocks/${encodeURIComponent(label)}`)
}

export function listPinnedSummaries(agentId: string): Promise<PinnedSummaryList> {
  return apiFetch<PinnedSummaryList>(`/v1/agents/${agentId}/memory/pinned-summaries`)
}

export function listEpisodes(agentId: string): Promise<EpisodeList> {
  return apiFetch<EpisodeList>(`/v1/agents/${agentId}/memory/episodes`)
}

export function listNarratives(agentId: string): Promise<NarrativeList> {
  return apiFetch<NarrativeList>(`/v1/agents/${agentId}/memory/narratives`)
}

export function listSettlements(agentId: string): Promise<SettlementList> {
  return apiFetch<SettlementList>(`/v1/agents/${agentId}/memory/settlements`)
}
