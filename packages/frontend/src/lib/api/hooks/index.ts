// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

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
// Deployment hooks
export {
	deploymentKeys,
	useBatchCreateDeployments,
	useDeleteDeployment,
	useDeployment,
	useDeployments,
	useLinkDeployment,
	useUnlinkDeployment,
	useUnlinkedDeploymentCount,
} from "./use-deployments-orpc";
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
// Integration hooks
export {
	integrationsKeys,
	serviceIntegrationsKeys,
	useConnectGitHubInstallation,
	useConnection,
	useConnectionDeletionImpact,
	useConnections,
	useCreateConnection,
	useCreateIntegration,
	useCreateServiceIntegration,
	useDeleteConnection,
	useDeleteIntegration,
	useDeleteServiceIntegration,
	// GitHub App hooks
	useGitHubInstallations,
	// Git / Service integration hooks
	useGitOrganizations,
	useGitRepositories,
	useIntegrationDeletionImpact,
	useIntegrations,
	// Service integration hooks
	useServiceIntegrations,
	useTemplate,
	// New names (three-layer model)
	useTemplates,
	useTestConnection,
	useUpdateConnection,
	useUpdateConnectionConfig,
	useUpdateIntegration,
	useUpdateServiceIntegration,
} from "./use-integrations-orpc";
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
// Ollama hooks
export { useOllamaModels } from "./use-ollama-models";
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

// Repository hooks
export {
	repositoryKeys,
	useBatchCreateRepositories,
	useDeleteRepository,
	useLinkRepository,
	useRepositories,
	useRepository,
	useUnlinkedRepositoryCount,
	useUnlinkRepository,
} from "./use-repositories-orpc";

// Service discovery hooks
export {
	serviceDiscoveryKeys,
	useAcceptBulkSuggestions,
	useAcceptSuggestion,
	useIgnoreSuggestion,
	useRejectSuggestion,
	useSuggestions,
	useTriggerDiscovery,
} from "./use-service-discovery-orpc";
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
	useUpdateServiceDependency,
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
