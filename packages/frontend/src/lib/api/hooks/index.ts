/**
 * TanStack Query hooks exports
 *
 * All hooks use oRPC for type-safe API calls.
 */

// Re-export the oRPC client for direct usage
export { client, orpc } from "../orpc-client";
// Alert hooks
export {
	alertKeys,
	useAcknowledgeAlert,
	useAlert,
	useAlertStats,
	useAlerts,
	useCreateAlert,
	useDeleteAlert,
	useResolveAlert,
	useUpdateAlert,
} from "./use-alerts-orpc";
// Incident hooks
export {
	incidentKeys,
	useActiveIncidents,
	useAddAlertToIncident,
	useCreateIncident,
	useIncident,
	useIncidentStats,
	useIncidents,
	useInvestigateIncident,
	useResolveIncident,
	useUpdateIncident,
} from "./use-incidents-orpc";
// Investigation hooks
export {
	investigationKeys,
	useCancelInvestigation,
	useCreateInvestigation,
	useInvestigation,
	useInvestigationStatus,
	useInvestigations,
	useInvestigationsByIncident,
} from "./use-investigations-orpc";

// Recommendation hooks
export {
	recommendationKeys,
	useCompleteRecommendation,
	useDismissRecommendation,
	useRecommendation,
	useRecommendationStats,
	useRecommendations,
	useRecommendationsByInvestigation,
	useUpdateRecommendation,
} from "./use-recommendations-orpc";
// Service hooks
export {
	serviceKeys,
	useAddServiceDependency,
	useCreateService,
	useDeleteService,
	useRemoveServiceDependency,
	useService,
	useServices,
	useServiceTopology,
	useUpdateService,
} from "./use-services-orpc";
