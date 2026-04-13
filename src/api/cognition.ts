import type {
  AssertionListResponse,
  CognitionHistoryResponse,
  CommitmentListResponse,
  EvaluationListResponse,
} from '../contracts'
import { apiFetch } from './client'

export interface CognitionListParams {
  limit?: number
  stance?: string
  status?: string
  since?: number
  request_id?: string
  settlement_id?: string
}

function buildQs(params?: CognitionListParams): string {
  if (!params) return ''
  const qp = new URLSearchParams()
  if (params.limit != null) qp.set('limit', String(params.limit))
  if (params.stance) qp.set('stance', params.stance)
  if (params.status) qp.set('status', params.status)
  if (params.since != null) qp.set('since', String(params.since))
  if (params.request_id) qp.set('request_id', params.request_id)
  if (params.settlement_id) qp.set('settlement_id', params.settlement_id)
  const qs = qp.toString()
  return qs.length > 0 ? `?${qs}` : ''
}

export function listCognitionAssertions(
  agentId: string,
  params?: CognitionListParams,
): Promise<AssertionListResponse> {
  return apiFetch<AssertionListResponse>(
    `/v1/agents/${encodeURIComponent(agentId)}/cognition/assertions${buildQs(params)}`,
  )
}

export function listCognitionEvaluations(
  agentId: string,
  params?: CognitionListParams,
): Promise<EvaluationListResponse> {
  return apiFetch<EvaluationListResponse>(
    `/v1/agents/${encodeURIComponent(agentId)}/cognition/evaluations${buildQs(params)}`,
  )
}

export function listCognitionCommitments(
  agentId: string,
  params?: CognitionListParams,
): Promise<CommitmentListResponse> {
  return apiFetch<CommitmentListResponse>(
    `/v1/agents/${encodeURIComponent(agentId)}/cognition/commitments${buildQs(params)}`,
  )
}

export function getCognitionHistory(
  agentId: string,
  cognitionKey: string,
): Promise<CognitionHistoryResponse> {
  return apiFetch<CognitionHistoryResponse>(
    `/v1/agents/${encodeURIComponent(agentId)}/cognition/${encodeURIComponent(cognitionKey)}/history`,
  )
}
