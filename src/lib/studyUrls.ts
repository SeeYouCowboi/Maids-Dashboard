/* ── Study URL builder ─────────────────────────────────────────────────── */

/**
 * Facet keys recognised by the Study page.
 * Keep in sync with the FACETS constant in StudyPage.tsx.
 */
export type FacetKey =
  | 'core-blocks'
  | 'episodes'
  | 'narratives'
  | 'settlements'
  | 'pinned-summaries'
  | 'retrieval-trace'
  | 'cognition'

export interface StudyUrlParams {
  agentId: string
  facet?: FacetKey
  request_id?: string | null
  settlement_id?: string | null
  tab?: string | null
  node_ref?: string | null
  direction?: string | null
  rp_only?: boolean | null
}

/**
 * Build a canonical Study deep-link. All Study navigation MUST use
 * this helper — no hand-rolled URL strings.
 */
export function buildStudyUrl(params: StudyUrlParams): string {
  const facet = params.facet ?? 'episodes'
  const base = `/study/${encodeURIComponent(params.agentId)}/${facet}`

  const qp = new URLSearchParams()
  if (params.request_id) qp.set('request_id', params.request_id)
  if (params.settlement_id) qp.set('settlement_id', params.settlement_id)
  if (params.tab) qp.set('tab', params.tab)
  if (params.node_ref) qp.set('node_ref', params.node_ref)
  if (params.direction) qp.set('direction', params.direction)
  if (params.rp_only === true) qp.set('rp_only', '1')

  const qs = qp.toString()
  return qs.length > 0 ? `${base}?${qs}` : base
}
