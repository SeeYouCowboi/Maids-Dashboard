import type { JobListResponse, JobDetailResponse } from '../contracts'
import { apiFetch } from './client'

export function listJobs(): Promise<JobListResponse> {
  return apiFetch<JobListResponse>('/v1/jobs')
}

export function getJobDetail(jobId: string): Promise<JobDetailResponse> {
  return apiFetch<JobDetailResponse>(`/v1/jobs/${jobId}`)
}
