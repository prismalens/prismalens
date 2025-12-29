'use client';

import { useQuery } from '@tanstack/react-query';
import {
  getAnalysisRuns,
  getAnalysisRun,
  getAnalysisRunStatus,
  getAnalysisRunsByAlert,
  getQueueStats,
} from '../analysis';

export const analysisKeys = {
  all: ['analysis'] as const,
  lists: () => [...analysisKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) =>
    [...analysisKeys.lists(), filters] as const,
  details: () => [...analysisKeys.all, 'detail'] as const,
  detail: (id: string) => [...analysisKeys.details(), id] as const,
  status: (id: string) => [...analysisKeys.detail(id), 'status'] as const,
  byAlert: (alertId: string) =>
    [...analysisKeys.all, 'byAlert', alertId] as const,
  queueStats: () => [...analysisKeys.all, 'queue', 'stats'] as const,
};

export function useAnalysisRuns(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: analysisKeys.list(params ?? {}),
    queryFn: () => getAnalysisRuns(params),
  });
}

export function useAnalysisRun(id: string) {
  return useQuery({
    queryKey: analysisKeys.detail(id),
    queryFn: () => getAnalysisRun(id),
    enabled: !!id,
  });
}

export function useAnalysisRunStatus(id: string, options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: analysisKeys.status(id),
    queryFn: () => getAnalysisRunStatus(id),
    enabled: !!id,
    refetchInterval: options?.refetchInterval,
  });
}

export function useAnalysisRunsByAlert(alertId: string) {
  return useQuery({
    queryKey: analysisKeys.byAlert(alertId),
    queryFn: () => getAnalysisRunsByAlert(alertId),
    enabled: !!alertId,
  });
}

export function useQueueStats() {
  return useQuery({
    queryKey: analysisKeys.queueStats(),
    queryFn: getQueueStats,
    refetchInterval: 5000, // Poll every 5 seconds
  });
}
