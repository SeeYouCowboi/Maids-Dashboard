import type {
  GraphEdgesResponse,
  GraphNodeDetailResponse,
  GraphNodeListResponse,
} from '../contracts'
import { apiFetch } from './client'

export interface GraphNodeListParams {
  session_id?: string
  since?: number
  limit?: number
  category?: string
  visibility?: string
}

function buildQs(params?: GraphNodeListParams): string {
  if (!params) return ''
  const qp = new URLSearchParams()
  if (params.session_id) qp.set('session_id', params.session_id)
  if (params.since != null) qp.set('since', String(params.since))
  if (params.limit != null) qp.set('limit', String(params.limit))
  if (params.category) qp.set('category', params.category)
  if (params.visibility) qp.set('visibility', params.visibility)
  const qs = qp.toString()
  return qs.length > 0 ? `?${qs}` : ''
}

export interface GraphEdgeListParams {
  types?: string
  direction?: 'out' | 'in' | 'both'
}

function buildEdgeQs(params?: GraphEdgeListParams): string {
  if (!params) return ''
  const qp = new URLSearchParams()
  if (params.types) qp.set('types', params.types)
  if (params.direction) qp.set('direction', params.direction)
  const qs = qp.toString()
  return qs.length > 0 ? `?${qs}` : ''
}

export function listGraphNodes(
  agentId: string,
  params?: GraphNodeListParams,
): Promise<GraphNodeListResponse> {
  return apiFetch<GraphNodeListResponse>(
    `/v1/agents/${encodeURIComponent(agentId)}/graph/nodes${buildQs(params)}`,
  )
}

export function getGraphNodeDetail(
  agentId: string,
  nodeRef: string,
): Promise<GraphNodeDetailResponse> {
  return apiFetch<GraphNodeDetailResponse>(
    `/v1/agents/${encodeURIComponent(agentId)}/graph/nodes/${encodeURIComponent(nodeRef)}`,
  )
}

export function listGraphNodeEdges(
  agentId: string,
  nodeRef: string,
  params?: GraphEdgeListParams,
): Promise<GraphEdgesResponse> {
  return apiFetch<GraphEdgesResponse>(
    `/v1/agents/${encodeURIComponent(agentId)}/graph/nodes/${encodeURIComponent(nodeRef)}/edges${buildEdgeQs(params)}`,
  )
}
