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

// Settings hooks
export {
	llmCredentialKeys,
	llmSettingsKeys,
	useDeleteLlmCredential,
	useFactoryReset,
	useInvestigationLimits,
	useInvestigationPolicies,
	useLlmCredentialStatus,
	useLlmEnvStatus,
	useLlmModels,
	useLlmSettings,
	useResetData,
	useSaveLlmCredential,
	useTestLlmConnectionWithEnv,
	useUpdateInvestigationLimits,
	useUpdateInvestigationPolicy,
	useUpdateLlmSettings,
} from "./use-settings-orpc";

// Integration hooks
export {
	integrationsKeys,
	serviceIntegrationsKeys,
	// New names (three-layer model)
	useTemplates,
	useTemplate,
	useIntegrations,
	useCreateIntegration,
	useDeleteIntegration,
	useConnections,
	useConnection,
	useCreateConnection,
	useUpdateConnection,
	useDeleteConnection,
	useTestConnection,
	// Git / Service integration hooks
	useGitOrganizations,
	useGitRepositories,
	useUpdateConnectionConfig,
	useServiceIntegrations,
	useCreateServiceIntegration,
	useUpdateServiceIntegration,
	useDeleteServiceIntegration,
} from "./use-integrations-orpc";

// Ollama hooks
export { useOllamaModels } from "./use-ollama-models";

// Setup hooks
export { useCreateOwner } from "./use-setup-orpc";

// Timeline hooks
export {
	timelineKeys,
	useCreateTimelineEntry,
	useDeleteTimelineEntry,
	useTimeline,
	useTimelineEntry,
} from "./use-timeline-orpc";

// Postmortem hooks
export {
	postmortemKeys,
	useCreatePostmortem,
	useDeletePostmortem,
	usePostmortem,
	usePostmortemByIncident,
	usePublishPostmortem,
	useUpdatePostmortem,
} from "./use-postmortems-orpc";
