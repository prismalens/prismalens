/**
 * Alerts API functions
 */

import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type {
  Alert,
  CreateAlertDto,
  UpdateAlertDto,
  AnalyzeAlertResponse,
} from './types';

export async function getAlerts(params?: {
  status?: string;
  severity?: string;
  limit?: number;
  offset?: number;
}): Promise<Alert[]> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.severity) searchParams.set('severity', params.severity);
  if (params?.limit) searchParams.set('limit', params.limit.toString());
  if (params?.offset) searchParams.set('offset', params.offset.toString());

  const query = searchParams.toString();
  return apiGet<Alert[]>(`/api/alerts${query ? `?${query}` : ''}`);
}

export async function getAlert(id: string): Promise<Alert> {
  return apiGet<Alert>(`/api/alerts/${id}`);
}

export async function createAlert(data: CreateAlertDto): Promise<Alert> {
  return apiPost<Alert, CreateAlertDto>('/api/alerts', data);
}

export async function updateAlert(
  id: string,
  data: UpdateAlertDto
): Promise<Alert> {
  return apiPatch<Alert, UpdateAlertDto>(`/api/alerts/${id}`, data);
}

export async function updateAlertStatus(
  id: string,
  status: string
): Promise<Alert> {
  return apiPatch<Alert>(`/api/alerts/${id}/status`, { status });
}

export async function deleteAlert(id: string): Promise<void> {
  return apiDelete(`/api/alerts/${id}`);
}

export async function analyzeAlert(id: string): Promise<AnalyzeAlertResponse> {
  return apiPost<AnalyzeAlertResponse>(`/api/alerts/${id}/analyze`);
}
