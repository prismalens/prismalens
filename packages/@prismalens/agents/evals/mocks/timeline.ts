/**
 * Timeline Builder for Evaluation Scenarios
 *
 * Creates consistent, relative timestamps for mock data.
 * All timestamps are relative to the incident time, making scenarios:
 * - Self-documenting: `timeline.beforeHours(25)` is clearer than a hardcoded ISO string
 * - Always aligned: Tests work at any time, no 2-year gaps
 * - Easy to reason about: "deployment 25 hours before incident" maps directly to validation windows
 *
 * Uses date-fns v4.1.0 for reliable, tree-shakeable date math.
 *
 * @example
 * ```typescript
 * const timeline = createTimeline();
 *
 * const scenario = {
 *   incident: createIncident({
 *     triggeredAt: timeline.incident,
 *   }),
 *   preGatheredContext: createMockPreGatheredContext({
 *     recentChanges: {
 *       deployments: [
 *         createMockDeployment({
 *           timestamp: timeline.beforeHours(2),  // 2 hours before incident
 *         }),
 *       ],
 *       commits: [
 *         createMockCommit({
 *           timestamp: timeline.beforeDays(3),  // 3 days before incident
 *         }),
 *       ],
 *     },
 *   }),
 * };
 * ```
 */

import { subHours, subDays, subMinutes, addHours, addMinutes } from "date-fns";

// =============================================================================
// TIMELINE INTERFACE
// =============================================================================

export interface Timeline {
	/** Base incident time as ISO string */
	incident: string;
	/** Base incident time as Date object */
	incidentDate: Date;

	// Offset methods (before = negative offset from incident)
	/** Get timestamp X hours before incident */
	beforeHours: (hours: number) => string;
	/** Get timestamp X minutes before incident */
	beforeMinutes: (minutes: number) => string;
	/** Get timestamp X days before incident */
	beforeDays: (days: number) => string;

	// Offset methods (after = positive offset from incident)
	/** Get timestamp X hours after incident */
	afterHours: (hours: number) => string;
	/** Get timestamp X minutes after incident */
	afterMinutes: (minutes: number) => string;

	/** Get Date object at offset (negative = before, positive = after) */
	offsetHours: (hours: number) => Date;
}

// =============================================================================
// TIMELINE FACTORY
// =============================================================================

/**
 * Create a timeline builder anchored to a specific incident time.
 *
 * @param incidentTime - The incident time to anchor all timestamps to.
 *                       Defaults to current time if not provided.
 *
 * @example
 * ```typescript
 * // Default: anchor to now
 * const timeline = createTimeline();
 *
 * // Specific time: anchor to a fixed point (for reproducible tests)
 * const timeline = createTimeline(new Date("2024-01-15T11:30:00Z"));
 * ```
 */
export function createTimeline(incidentTime?: Date): Timeline {
	const base = incidentTime || new Date();

	return {
		incident: base.toISOString(),
		incidentDate: base,

		beforeHours: (hours: number) => subHours(base, hours).toISOString(),
		beforeMinutes: (minutes: number) => subMinutes(base, minutes).toISOString(),
		beforeDays: (days: number) => subDays(base, days).toISOString(),

		afterHours: (hours: number) => addHours(base, hours).toISOString(),
		afterMinutes: (minutes: number) => addMinutes(base, minutes).toISOString(),

		offsetHours: (hours: number) => (hours >= 0 ? addHours(base, hours) : subHours(base, -hours)),
	};
}

// =============================================================================
// VALIDATION WINDOW REFERENCE
// =============================================================================

/**
 * Reference constants for validation window levels.
 * Use these to understand what offsets will pass/fail validation.
 *
 * Log Windows:
 * - Level 1: -4h to +1h (fast, most relevant)
 * - Level 2: -12h to +2h (broader)
 * - Level 3: -48h to +4h (maximum)
 *
 * Change Windows (before incident only):
 * - Level 1: 24 hours
 * - Level 2: 72 hours (3 days)
 * - Level 3: 168 hours (1 week)
 *
 * @example
 * ```typescript
 * // Deployment that will pass Level 1 validation (within 24h)
 * timeline.beforeHours(20)
 *
 * // Deployment that requires Level 2 (between 24h and 72h)
 * timeline.beforeHours(48)
 *
 * // Deployment that requires Level 3 (between 72h and 168h)
 * timeline.beforeDays(5)
 * ```
 */
export const VALIDATION_WINDOWS = {
	log: {
		level1: { before: 4, after: 1 },
		level2: { before: 12, after: 2 },
		level3: { before: 48, after: 4 },
	},
	change: {
		level1: 24,  // hours
		level2: 72,  // hours (3 days)
		level3: 168, // hours (1 week)
	},
} as const;

// =============================================================================
// PRESET TIMELINE SCENARIOS
// =============================================================================

/**
 * Create timeline for "recent deployment" scenario.
 * Deployment is well within Level 1 window.
 */
export function recentDeploymentTimeline(): {
	timeline: Timeline;
	deploymentOffset: number;
	commitOffset: number;
} {
	const timeline = createTimeline();
	return {
		timeline,
		deploymentOffset: 2,  // 2 hours before incident (within 24h window)
		commitOffset: 4,      // 4 hours before incident
	};
}

/**
 * Create timeline for "borderline" scenario.
 * Deployment is just outside Level 1 but inside Level 2.
 * Tests window expansion logic.
 */
export function borderlineDeploymentTimeline(): {
	timeline: Timeline;
	deploymentOffset: number;
	commitOffset: number;
} {
	const timeline = createTimeline();
	return {
		timeline,
		deploymentOffset: 26, // 26 hours before (just outside 24h, inside 72h)
		commitOffset: 48,     // 2 days before
	};
}

/**
 * Create timeline for "old changes" scenario.
 * Changes are outside Level 1 and Level 2, requiring Level 3.
 */
export function oldChangesTimeline(): {
	timeline: Timeline;
	deploymentOffset: number;
	commitOffset: number;
} {
	const timeline = createTimeline();
	return {
		timeline,
		deploymentOffset: 96,  // 4 days before (outside 72h, inside 168h)
		commitOffset: 120,     // 5 days before
	};
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
	createTimeline,
	recentDeploymentTimeline,
	borderlineDeploymentTimeline,
	oldChangesTimeline,
	VALIDATION_WINDOWS,
};
