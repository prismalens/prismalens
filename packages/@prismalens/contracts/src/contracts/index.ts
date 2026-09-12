// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Import individual contracts
export { alertsContract } from "./alerts.js";
export { eventsContract } from "./events.js";
export { incidentsContract } from "./incidents.js";
export { integrationsContract, oauthContract } from "./integrations.js";
export { investigationsContract } from "./investigations.js";
export { recommendationsContract } from "./recommendations.js";
export { repositoriesContract } from "./repositories.js";
export { servicesContract } from "./services.js";
export { settingsContract } from "./settings.js";
export {
	SETUP_STEP_ORDER,
	type SetupStatus,
	type SetupStep,
	SetupStepEnum,
	setupContract,
} from "./setup.js";
export { timelineContract } from "./timeline.js";
export { webhooksContract } from "./webhooks.js";

// Re-import for combined contract
import { alertsContract } from "./alerts.js";
import { eventsContract } from "./events.js";
import { incidentsContract } from "./incidents.js";
import { integrationsContract, oauthContract } from "./integrations.js";
import { investigationsContract } from "./investigations.js";
import { recommendationsContract } from "./recommendations.js";
import { repositoriesContract } from "./repositories.js";
import { servicesContract } from "./services.js";
import { settingsContract } from "./settings.js";
import { setupContract } from "./setup.js";
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
	repositories: repositoriesContract,
	services: servicesContract,
	webhooks: webhooksContract,
	events: eventsContract,
	timeline: timelineContract,
	integrations: integrationsContract,
	oauth: oauthContract,
	settings: settingsContract,
	setup: setupContract,
};

export type Contract = typeof contract;
