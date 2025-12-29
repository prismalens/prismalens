/**
 * Analysis API functions
 */

import { apiGet } from './client';
import type { AnalysisRun, QueueStats } from './types';

export async function getAnalysisRuns(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<AnalysisRun[]> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.limit) searchParams.set('limit', params.limit.toString());
  if (params?.offset) searchParams.set('offset', params.offset.toString());

  const query = searchParams.toString();
  return apiGet<AnalysisRun[]>(`/api/analysis${query ? `?${query}` : ''}`);
}

export async function getAnalysisRun(id: string): Promise<AnalysisRun> {
  return apiGet<AnalysisRun>(`/api/analysis/${id}`);
}

export async function getAnalysisRunStatus(id: string): Promise<{
  analysisRun: AnalysisRun | null;
  job: { status: string; progress: number } | null;
}> {
  return apiGet(`/api/analysis/${id}/status`);
}

export async function getAnalysisRunsByAlert(
  alertId: string
): Promise<AnalysisRun[]> {
  return apiGet<AnalysisRun[]>(`/api/analysis/alert/${alertId}`);
}

export async function getQueueStats(): Promise<QueueStats> {
  return apiGet<QueueStats>('/api/analysis/queue/stats');
}
