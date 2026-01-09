/**
 * Contract exports
 * All oRPC route contracts combined into a single router
 */
import { oc } from "@orpc/contract";

export { alertMappingContract } from "./alert-mapping.js";
// Import individual contracts
export { alertsContract } from "./alerts.js";
export { correlationContract } from "./correlation.js";
export { eventsContract } from "./events.js";
export { incidentsContract } from "./incidents.js";
export { integrationsContract, oauthContract } from "./integrations.js";
export { investigationsContract } from "./investigations.js";
export { recommendationsContract } from "./recommendations.js";
export { serviceDiscoveryContract } from "./service-discovery.js";
export { servicesContract } from "./services.js";
export { timelineContract } from "./timeline.js";
export { webhooksContract } from "./webhooks.js";

import { alertMappingContract } from "./alert-mapping.js";
// Re-import for combined contract
import { alertsContract } from "./alerts.js";
import { correlationContract } from "./correlation.js";
import { eventsContract } from "./events.js";
import { incidentsContract } from "./incidents.js";
import { integrationsContract, oauthContract } from "./integrations.js";
import { investigationsContract } from "./investigations.js";
import { recommendationsContract } from "./recommendations.js";
import { serviceDiscoveryContract } from "./service-discovery.js";
import { servicesContract } from "./services.js";
import { timelineContract } from "./timeline.js";
import { webhooksContract } from "./webhooks.js";

/**
 * Combined API contract
 * Use this for generating OpenAPI specs and client types
 */
export const contract = {
	alerts: alertsContract,
	incidents: incidentsContract,
	investigations: investigationsContract,
	recommendations: recommendationsContract,
	services: servicesContract,
	webhooks: webhooksContract,
	events: eventsContract,
	timeline: timelineContract,
	correlation: correlationContract,
	integrations: integrationsContract,
	oauth: oauthContract,
	serviceDiscovery: serviceDiscoveryContract,
	alertMapping: alertMappingContract,
};

export type Contract = typeof contract;
