/**
 * API client exports
 */

// Client utilities
export { apiGet, apiPost, apiPatch, apiDelete, ApiError } from './client';

// Types
export type {
  Alert,
  AnalysisRun,
  Recommendation,
  CreateAlertDto,
  UpdateAlertDto,
  UpdateRecommendationDto,
  AnalyzeAlertResponse,
  QueueStats,
  RecommendationStats,
} from './types';

// Alert API
export {
  getAlerts,
  getAlert,
  createAlert,
  updateAlert,
  updateAlertStatus,
  deleteAlert,
  analyzeAlert,
} from './alerts';

// Analysis API
export {
  getAnalysisRuns,
  getAnalysisRun,
  getAnalysisRunStatus,
  getAnalysisRunsByAlert,
  getQueueStats,
} from './analysis';

// Recommendations API
export {
  getRecommendations,
  getRecommendation,
  getRecommendationsByAnalysisRun,
  updateRecommendation,
  getRecommendationStats,
} from './recommendations';
