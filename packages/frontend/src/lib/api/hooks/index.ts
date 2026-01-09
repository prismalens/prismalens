/**
 * TanStack Query hooks exports
 *
 * All hooks use oRPC for type-safe API calls.
 */

// Alert hooks
export {
  useAlerts,
  useAlert,
  useAlertStats,
  useCreateAlert,
  useUpdateAlert,
  useDeleteAlert,
  useAcknowledgeAlert,
  useResolveAlert,
  alertKeys,
} from './use-alerts-orpc'

// Incident hooks
export {
  useIncidents,
  useIncident,
  useActiveIncidents,
  useIncidentStats,
  useCreateIncident,
  useUpdateIncident,
  useResolveIncident,
  useInvestigateIncident,
  useAddAlertToIncident,
  incidentKeys,
} from './use-incidents-orpc'

// Investigation hooks
export {
  useInvestigations,
  useInvestigation,
  useInvestigationStatus,
  useInvestigationsByIncident,
  useCreateInvestigation,
  useCancelInvestigation,
  investigationKeys,
} from './use-investigations-orpc'

// Service hooks
export {
  useServices,
  useService,
  useServiceTopology,
  useCreateService,
  useUpdateService,
  useDeleteService,
  useAddServiceDependency,
  useRemoveServiceDependency,
  serviceKeys,
} from './use-services-orpc'

// Recommendation hooks
export {
  useRecommendations,
  useRecommendation,
  useRecommendationsByInvestigation,
  useRecommendationStats,
  useUpdateRecommendation,
  useCompleteRecommendation,
  useDismissRecommendation,
  recommendationKeys,
} from './use-recommendations-orpc'

// Re-export the oRPC client for direct usage
export { orpc, client } from '../orpc-client'
