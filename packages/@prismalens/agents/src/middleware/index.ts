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
	CARTOGRAPHER_SYSTEM_REMINDER,
	DETECTIVE_SYSTEM_REMINDER,
	SURGEON_SYSTEM_REMINDER,
	getSystemReminder,
	injectSystemReminder,
} from "./system-reminders.js";
