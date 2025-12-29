'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getRecommendations,
  getRecommendation,
  getRecommendationsByAnalysisRun,
  updateRecommendation,
  getRecommendationStats,
} from '../recommendations';
import type { Recommendation, UpdateRecommendationDto } from '../types';

export const recommendationKeys = {
  all: ['recommendations'] as const,
  lists: () => [...recommendationKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) =>
    [...recommendationKeys.lists(), filters] as const,
  details: () => [...recommendationKeys.all, 'detail'] as const,
  detail: (id: string) => [...recommendationKeys.details(), id] as const,
  byAnalysisRun: (analysisRunId: string) =>
    [...recommendationKeys.all, 'byAnalysisRun', analysisRunId] as const,
  stats: () => [...recommendationKeys.all, 'stats'] as const,
};

export function useRecommendations(params?: {
  status?: string;
  priority?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: recommendationKeys.list(params ?? {}),
    queryFn: () => getRecommendations(params),
  });
}

export function useRecommendation(id: string) {
  return useQuery({
    queryKey: recommendationKeys.detail(id),
    queryFn: () => getRecommendation(id),
    enabled: !!id,
  });
}

export function useRecommendationsByAnalysisRun(analysisRunId: string) {
  return useQuery({
    queryKey: recommendationKeys.byAnalysisRun(analysisRunId),
    queryFn: () => getRecommendationsByAnalysisRun(analysisRunId),
    enabled: !!analysisRunId,
  });
}

export function useUpdateRecommendation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: UpdateRecommendationDto;
    }) => updateRecommendation(id, data),
    onSuccess: (recommendation: Recommendation) => {
      queryClient.invalidateQueries({ queryKey: recommendationKeys.lists() });
      queryClient.invalidateQueries({ queryKey: recommendationKeys.stats() });
      queryClient.setQueryData(
        recommendationKeys.detail(recommendation.id),
        recommendation
      );
    },
  });
}

export function useRecommendationStats() {
  return useQuery({
    queryKey: recommendationKeys.stats(),
    queryFn: getRecommendationStats,
  });
}
