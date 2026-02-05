/**
 * Change correlation for pre-gathering phase
 * Based on BigPanda pattern: 60-90% of incidents are change-related
 */

import { Logger } from "@prismalens/logger";
import type {
	CommitChange,
	ConfigChange,
	DeploymentChange,
	RecentChangesContext,
} from "../../../types/index.js";
import {
	CHANGE_RISK_THRESHOLDS,
	TIME_WINDOWS,
	type GatheringContext,
	type GatherResult,
} from "./types.js";

const logger = new Logger({ context: "PreGather:Changes" });

/**
 * Calculate risk score for a deployment based on BigPanda pattern
 * Higher scores indicate more likely correlation with the incident
 */
export function calculateDeploymentRiskScore(
	deploymentTime: Date,
	incidentTime: Date,
	options: {
		status?: "success" | "failed" | "rolled_back" | "in_progress";
		containsMigration?: boolean;
		affectsService?: boolean;
	} = {},
): { score: number; factors: string[] } {
	const timeDeltaMinutes =
		(incidentTime.getTime() - deploymentTime.getTime()) / (1000 * 60);
	const factors: string[] = [];
	let score = 0;

	// Deployment must be BEFORE the incident to be relevant
	if (timeDeltaMinutes < 0) {
		return { score: 0, factors: ["Deployment occurred after incident"] };
	}

	// Time-based scoring (BigPanda pattern)
	if (timeDeltaMinutes <= TIME_WINDOWS.ONE_HOUR_MINUTES) {
		score += 30;
		factors.push("Within 1 hour of incident (+30)");
	} else if (timeDeltaMinutes <= TIME_WINDOWS.TWO_HOURS_MINUTES) {
		score += 20;
		factors.push("Within 2 hours of incident (+20)");
	} else if (timeDeltaMinutes <= TIME_WINDOWS.ONE_DAY_MINUTES) {
		score += 10;
		factors.push("Within 24 hours of incident (+10)");
	}

	// Status-based scoring
	if (options.status === "failed") {
		score += 25;
		factors.push("Deployment failed (+25)");
	} else if (options.status === "rolled_back") {
		score += 25;
		factors.push("Deployment was rolled back (+25)");
	} else if (options.status === "in_progress") {
		score += 15;
		factors.push("Deployment in progress (+15)");
	}

	// Content-based scoring
	if (options.containsMigration) {
		score += 20;
		factors.push("Contains migration (+20)");
	}

	// Service affinity
	if (options.affectsService) {
		score += 15;
		factors.push("Affects related service (+15)");
	}

	return { score: Math.min(score, 100), factors };
}

/**
 * Fetch recent changes (deployments, commits, config changes)
 * Currently returns empty data - will be populated when Change tracking is implemented
 */
export async function fetchRecentChanges(
	ctx: GatheringContext,
): Promise<GatherResult<RecentChangesContext>> {
	const startTime = Date.now();

	try {
		const { incidentTime, serviceId } = ctx;
		logger.debug("Fetching recent changes", {
			incidentTime: incidentTime.toISOString(),
			serviceId,
		});

		// TODO: Query ChangeEvent table when implemented
		// For now, return empty arrays - this will be populated when:
		// 1. ChangeEvent model is added to the database
		// 2. Render webhook integration captures deployments
		// 3. GitHub webhook integration captures commits

		const deployments: DeploymentChange[] = [];
		const commits: CommitChange[] = [];
		const configChanges: ConfigChange[] = [];

		// Sort deployments by risk score (highest first)
		deployments.sort((a, b) => b.riskScore - a.riskScore);

		logger.debug("Fetched recent changes", {
			deployments: deployments.length,
			commits: commits.length,
			configChanges: configChanges.length,
		});

		return {
			success: true,
			data: {
				deployments,
				commits,
				configChanges,
			},
			durationMs: Date.now() - startTime,
		};
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		logger.error("Failed to fetch recent changes", { error: errorMessage });
		return {
			success: false,
			data: null,
			error: errorMessage,
			durationMs: Date.now() - startTime,
		};
	}
}

/**
 * Check if a deployment is high-risk based on score threshold
 */
export function isHighRiskDeployment(deployment: DeploymentChange): boolean {
	return deployment.riskScore >= CHANGE_RISK_THRESHOLDS.HIGH;
}

/**
 * Get top risky deployments for commander hints
 */
export function getTopRiskyDeployments(
	deployments: DeploymentChange[],
	limit: number = 3,
): DeploymentChange[] {
	return deployments
		.filter((d) => d.riskScore >= CHANGE_RISK_THRESHOLDS.MEDIUM)
		.sort((a, b) => b.riskScore - a.riskScore)
		.slice(0, limit);
}
