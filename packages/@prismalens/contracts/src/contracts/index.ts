/**
 * Contract exports
 * All oRPC route contracts combined into a single router
 */
import { oc } from "@orpc/contract";

export { alertMappingContract } from "./alert-mapping.js";
// Import individual contracts
export { alertsContract } from "./alerts.js";
export { correlationContract } from "./correlation.js";
export { deploymentsContract } from "./deployments.js";
export { settingsContract } from "./settings.js";
export { setupContract, type SetupStep } from "./setup.js";
export { eventsContract } from "./events.js";
export { incidentsContract } from "./incidents.js";
export { integrationsContract, oauthContract } from "./integrations.js";
export { investigationsContract } from "./investigations.js";
export { recommendationsContract } from "./recommendations.js";
export { repositoriesContract } from "./repositories.js";
export { serviceDiscoveryContract } from "./service-discovery.js";
export { servicesContract } from "./services.js";
export { timelineContract } from "./timeline.js";
export { postmortemsContract } from "./postmortems.js";
export { webhooksContract } from "./webhooks.js";

import { alertMappingContract } from "./alert-mapping.js";
// Re-import for combined contract
import { alertsContract } from "./alerts.js";
import { correlationContract } from "./correlation.js";
import { deploymentsContract } from "./deployments.js";
import { settingsContract } from "./settings.js";
import { setupContract } from "./setup.js";
import { eventsContract } from "./events.js";
import { incidentsContract } from "./incidents.js";
import { integrationsContract, oauthContract } from "./integrations.js";
import { investigationsContract } from "./investigations.js";
import { recommendationsContract } from "./recommendations.js";
import { repositoriesContract } from "./repositories.js";
import { serviceDiscoveryContract } from "./service-discovery.js";
import { servicesContract } from "./services.js";
import { timelineContract } from "./timeline.js";
import { postmortemsContract } from "./postmortems.js";
import { webhooksContract } from "./webhooks.js";

/**
 * Combined API contract
 * Use this for generating OpenAPI specs and client types
 */
export const contract = {
	alerts: alertsContract,
	deployments: deploymentsContract,
	incidents: incidentsContract,
	investigations: investigationsContract,
	recommendations: recommendationsContract,
	repositories: repositoriesContract,
	services: servicesContract,
	webhooks: webhooksContract,
	events: eventsContract,
	timeline: timelineContract,
	postmortems: postmortemsContract,
	correlation: correlationContract,
	integrations: integrationsContract,
	oauth: oauthContract,
	serviceDiscovery: serviceDiscoveryContract,
	alertMapping: alertMappingContract,
	settings: settingsContract,
	setup: setupContract,
};

export type Contract = typeof contract;
