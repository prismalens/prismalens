/**
 * TanStack Query hooks exports
 */

export {
  alertKeys,
  useAlerts,
  useAlert,
  useCreateAlert,
  useUpdateAlert,
  useDeleteAlert,
  useAnalyzeAlert,
} from './use-alerts';

export {
  analysisKeys,
  useAnalysisRuns,
  useAnalysisRun,
  useAnalysisRunStatus,
  useAnalysisRunsByAlert,
  useQueueStats,
} from './use-analysis';

export {
  recommendationKeys,
  useRecommendations,
  useRecommendation,
  useRecommendationsByAnalysisRun,
  useUpdateRecommendation,
  useRecommendationStats,
} from './use-recommendations';
