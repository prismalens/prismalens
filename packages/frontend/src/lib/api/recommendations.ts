/**
 * Recommendations API functions
 */

import { apiGet, apiPatch } from './client';
import type {
  Recommendation,
  UpdateRecommendationDto,
  RecommendationStats,
} from './types';

export async function getRecommendations(params?: {
  status?: string;
  priority?: string;
  limit?: number;
  offset?: number;
}): Promise<Recommendation[]> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.priority) searchParams.set('priority', params.priority);
  if (params?.limit) searchParams.set('limit', params.limit.toString());
  if (params?.offset) searchParams.set('offset', params.offset.toString());

  const query = searchParams.toString();
  return apiGet<Recommendation[]>(
    `/api/recommendations${query ? `?${query}` : ''}`
  );
}

export async function getRecommendation(id: string): Promise<Recommendation> {
  return apiGet<Recommendation>(`/api/recommendations/${id}`);
}

export async function getRecommendationsByAnalysisRun(
  analysisRunId: string
): Promise<Recommendation[]> {
  return apiGet<Recommendation[]>(
    `/api/recommendations/analysis-run/${analysisRunId}`
  );
}

export async function updateRecommendation(
  id: string,
  data: UpdateRecommendationDto
): Promise<Recommendation> {
  return apiPatch<Recommendation, UpdateRecommendationDto>(
    `/api/recommendations/${id}`,
    data
  );
}

export async function getRecommendationStats(): Promise<RecommendationStats> {
  return apiGet<RecommendationStats>('/api/recommendations/stats');
}
