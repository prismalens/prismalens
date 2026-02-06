/**
 * Change correlation for pre-gathering phase
 * Based on BigPanda pattern: 60-90% of incidents are change-related
 *
 * Uses headless MCP tool calls to fetch commits/deployments from
 * whatever SCM/deploy integration is configured (GitHub, Render, etc.).
 */

import { Logger } from "@prismalens/logger";
import type {
	CommitChange,
	ConfigChange,
	DeploymentChange,
	RecentChangesContext,
} from "../../../types/index.js";
import { callMCPTool, findBundleForCapability } from "./mcp-caller.js";
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
 * Fetch recent changes (deployments, commits, config changes).
 * Uses headless MCP tool calls to fetch from configured integrations.
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

		const twentyFourHoursAgo = new Date(
			incidentTime.getTime() - 24 * 60 * 60 * 1000,
		).toISOString();

		let deployments: DeploymentChange[] = [];
		let commits: CommitChange[] = [];
		const configChanges: ConfigChange[] = [];

		// Fetch commits via MCP (github-mcp, gitlab-mcp, etc.)
		if (ctx.registry && ctx.repository) {
			const commitBundle = await findBundleForCapability(ctx.registry, "commits");
			if (commitBundle) {
				// Parse owner/repo from repository string (e.g., "owner/repo" or "github.com/owner/repo")
				const parts = ctx.repository.replace(/^https?:\/\/[^/]+\//, "").split("/");
				const [owner, repo] = parts.length >= 2 ? parts.slice(-2) : [parts[0], undefined];
				if (owner && repo) {
					const result = await callMCPTool(
						ctx.registry,
						commitBundle,
						"list_commits",
						{
							owner,
							repo,
							since: twentyFourHoursAgo,
							perPage: 20,
						},
						ctx.integrations,
					);

					if (result.success && result.data) {
						commits = parseCommits(result.data, ctx.repository);
					}
				}
			}
		}

		// Fetch deployments via MCP (render-mcp, etc.)
		if (ctx.registry && serviceId) {
			const deployBundle = await findBundleForCapability(ctx.registry, "deployments");
			if (deployBundle) {
				const result = await callMCPTool(
					ctx.registry,
					deployBundle,
					"list_deploys",
					{
						serviceId,
						limit: 10,
					},
					ctx.integrations,
				);

				if (result.success && result.data) {
					deployments = parseDeployments(result.data, incidentTime, serviceId);
				}
			}
		}

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
 * Parse raw MCP commit output into CommitChange array.
 */
function parseCommits(rawOutput: string, repository: string): CommitChange[] {
	try {
		const parsed = JSON.parse(rawOutput);
		if (Array.isArray(parsed)) {
			return parsed.map((item) => ({
				sha: item.sha ?? item.id ?? "",
				message: item.message ?? item.commit?.message ?? "",
				author:
					item.author?.login ??
					item.commit?.author?.name ??
					item.author_name ??
					"unknown",
				timestamp:
					item.commit?.author?.date ??
					item.created_at ??
					item.timestamp ??
					new Date().toISOString(),
				repository,
				url: item.html_url ?? item.web_url,
			}));
		}
	} catch {
		logger.debug("Failed to parse commits response as JSON", {
			length: rawOutput.length,
			preview: rawOutput.slice(0, 100),
		});
	}
	return [];
}

/**
 * Parse raw MCP deployment output into DeploymentChange array with risk scoring.
 */
function parseDeployments(
	rawOutput: string,
	incidentTime: Date,
	serviceId: string,
): DeploymentChange[] {
	try {
		const parsed = JSON.parse(rawOutput);
		if (Array.isArray(parsed)) {
			return parsed.map((item) => {
				const deployTime = new Date(
					item.createdAt ?? item.created_at ?? item.timestamp ?? Date.now(),
				);
				const status = normalizeDeployStatus(
					item.status ?? item.state ?? "success",
				);
				const { score, factors } = calculateDeploymentRiskScore(
					deployTime,
					incidentTime,
					{
						status,
						affectsService: true,
					},
				);

				return {
					id: item.id ?? item.deploy_id ?? "",
					timestamp: deployTime.toISOString(),
					service: serviceId,
					version: item.commit?.id?.slice(0, 7) ?? item.version,
					status,
					riskScore: score,
					riskFactors: factors,
					url: item.url ?? item.web_url,
				};
			});
		}
	} catch {
		logger.debug("Failed to parse deployments response as JSON", {
			length: rawOutput.length,
			preview: rawOutput.slice(0, 100),
		});
	}
	return [];
}

function normalizeDeployStatus(
	status: string,
): "success" | "failed" | "rolled_back" | "in_progress" {
	const lower = status.toLowerCase();
	if (lower.includes("fail") || lower === "build_failed" || lower === "update_failed") return "failed";
	if (lower.includes("roll") || lower === "deactivated") return "rolled_back";
	if (lower.includes("progress") || lower === "building" || lower === "deploying" || lower === "created") return "in_progress";
	return "success";
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
