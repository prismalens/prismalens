// =============================================================================
// MIDDLEWARE INDEX
// =============================================================================
// Exports all middleware for the agents package.
// =============================================================================

export {
	createDefaultToolDisclosureMiddleware,
	createToolDisclosureMiddleware,
	isToolDisclosureMiddleware,
	type ToolDisclosureMiddleware,
	type ToolDisclosureMiddlewareOptions,
	type ToolDisclosureMiddlewareState,
} from "./tool-disclosure.js";

export {
	GATHERER_SYSTEM_REMINDER,
	DETECTIVE_SYSTEM_REMINDER,
	SURGEON_SYSTEM_REMINDER,
	getSystemReminder,
	injectSystemReminder,
} from "./system-reminders.js";

// Todos removed - using simple findings-based routing instead
