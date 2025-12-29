'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAlerts,
  getAlert,
  createAlert,
  updateAlert,
  deleteAlert,
  analyzeAlert,
} from '../alerts';
import type { Alert, CreateAlertDto, UpdateAlertDto } from '../types';

export const alertKeys = {
  all: ['alerts'] as const,
  lists: () => [...alertKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) =>
    [...alertKeys.lists(), filters] as const,
  details: () => [...alertKeys.all, 'detail'] as const,
  detail: (id: string) => [...alertKeys.details(), id] as const,
};

export function useAlerts(params?: {
  status?: string;
  severity?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: alertKeys.list(params ?? {}),
    queryFn: () => getAlerts(params),
  });
}

export function useAlert(id: string) {
  return useQuery({
    queryKey: alertKeys.detail(id),
    queryFn: () => getAlert(id),
    enabled: !!id,
  });
}

export function useCreateAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateAlertDto) => createAlert(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: alertKeys.lists() });
    },
  });
}

export function useUpdateAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAlertDto }) =>
      updateAlert(id, data),
    onSuccess: (alert: Alert) => {
      queryClient.invalidateQueries({ queryKey: alertKeys.lists() });
      queryClient.setQueryData(alertKeys.detail(alert.id), alert);
    },
  });
}

export function useDeleteAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteAlert(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: alertKeys.lists() });
    },
  });
}

export function useAnalyzeAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => analyzeAlert(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: alertKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: alertKeys.lists() });
    },
  });
}
