/**
 * API client exports
 */

// Alert API
export {
	analyzeAlert,
	createAlert,
	deleteAlert,
	getAlert,
	getAlerts,
	updateAlert,
	updateAlertStatus,
} from "./alerts";
// Analysis API
export {
	getAnalysisRun,
	getAnalysisRunStatus,
	getAnalysisRuns,
	getAnalysisRunsByAlert,
	getQueueStats,
} from "./analysis";
// Client utilities
export { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "./client";
// Recommendations API
export {
	getRecommendation,
	getRecommendationStats,
	getRecommendations,
	getRecommendationsByAnalysisRun,
	updateRecommendation,
} from "./recommendations";
// Types
export type {
	Alert,
	AnalysisRun,
	AnalyzeAlertResponse,
	CreateAlertDto,
	QueueStats,
	Recommendation,
	RecommendationStats,
	UpdateAlertDto,
	UpdateRecommendationDto,
} from "./types";
