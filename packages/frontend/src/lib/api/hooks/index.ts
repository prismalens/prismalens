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
	useInvestigationProgress,
	useInvestigationProgressHistory,
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
	llmSettingsKeys,
	mcpSettingsKeys,
	settingsKeys,
	useDeleteLlmConfig,
	useFactoryReset,
	useInvestigationLimits,
	useInvestigationPolicies,
	useLlmConfig,
	useLlmConfigs,
	useLlmEnvStatus,
	useLlmModels,
	useLlmSettings,
	useMcpServerStatus,
	useMcpSettings,
	useMcpStatus,
	useResetData,
	useSetActiveLlmProvider,
	useTestLlmConnection,
	useTestLlmConnectionWithEnv,
	useTestMcpConnection,
	useUpdateInvestigationLimits,
	useUpdateInvestigationPolicy,
	useUpdateLlmConfig,
	useUpdateLlmSettings,
	useUpdateMcpSettings,
} from "./use-settings-orpc";

// Integration hooks
export {
	integrationsKeys,
	serviceIntegrationsKeys,
	useCreateIntegrationConnection,
	useCreateServiceIntegration,
	useDeleteIntegrationConnection,
	useDeleteServiceIntegration,
	useGitOrganizations,
	useGitRepositories,
	useIntegrationConnection,
	useIntegrationConnections,
	useIntegrationDefinition,
	useIntegrationDefinitions,
	useServiceIntegrations,
	useTestIntegrationConnection,
	useUpdateConnectionConfig,
	useUpdateIntegrationConnection,
	useUpdateServiceIntegration,
} from "./use-integrations-orpc";

// Setup hooks
export {
	setupKeys,
	useCreateOwner,
	useMarkStepSkipped,
	useSetupStatus,
} from "./use-setup-orpc";

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
