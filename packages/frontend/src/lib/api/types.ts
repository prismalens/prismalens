/**
 * API Types matching the NestJS API
 */

export interface Alert {
  id: string;
  externalId?: string;
  title: string;
  description?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'new' | 'acknowledged' | 'analyzing' | 'resolved';
  source?: string;
  sourceUrl?: string;
  rawPayload?: string;
  createdAt: string;
  updatedAt: string;
  analysisRuns?: AnalysisRun[];
}

export interface AnalysisRun {
  id: string;
  alertId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  summary?: string;
  rootCause?: string;
  rawOutput?: string;
  createdAt: string;
  updatedAt: string;
  recommendations?: Recommendation[];
}

export interface Recommendation {
  id: string;
  analysisRunId: string;
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  category?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'dismissed';
  createdAt: string;
  updatedAt: string;
}

export interface CreateAlertDto {
  title: string;
  description?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  source?: string;
  sourceUrl?: string;
  externalId?: string;
  rawPayload?: Record<string, unknown>;
}

export interface UpdateAlertDto {
  status?: string;
  severity?: string;
  title?: string;
  description?: string;
}

export interface UpdateRecommendationDto {
  status?: 'pending' | 'in_progress' | 'completed' | 'dismissed';
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

export interface AnalyzeAlertResponse {
  alertId: string;
  analysisRunId: string;
  jobId: string | null;
  queued: boolean;
}

export interface QueueStats {
  enabled: boolean;
  stats: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  } | null;
}

export interface RecommendationStats {
  total: number;
  byStatus: Record<string, number>;
}
