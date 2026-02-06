/**
 * Similar incident matching for pre-gathering phase
 * Based on BigPanda 30% similarity threshold pattern
 */

import { Logger } from "@prismalens/logger";
import type {
	IncidentContext,
	IncidentPattern,
	PastResolution,
	SimilarIncidentMatch,
	SimilarIncidentsContext,
} from "../../../types/index.js";
import {
	SIMILARITY_THRESHOLDS,
	TIME_WINDOWS,
	type GatheringContext,
	type GatherResult,
} from "./types.js";

const logger = new Logger({ context: "PreGather:SimilarIncidents" });

/**
 * Calculate string similarity using Levenshtein distance ratio
 * Returns a value between 0 (completely different) and 1 (identical)
 */
function stringSimilarity(str1: string, str2: string): number {
	const s1 = str1.toLowerCase().trim();
	const s2 = str2.toLowerCase().trim();

	if (s1 === s2) return 1;
	if (s1.length === 0 || s2.length === 0) return 0;

	// Use Jaccard similarity for speed on longer strings
	const words1 = new Set(s1.split(/\s+/));
	const words2 = new Set(s2.split(/\s+/));

	const intersection = new Set([...words1].filter((x) => words2.has(x)));
	const union = new Set([...words1, ...words2]);

	return intersection.size / union.size;
}

/**
 * Calculate similarity between current incident and a historical incident
 * Based on BigPanda pattern with weighted factors
 */
export function calculateIncidentSimilarity(
	current: {
		title: string;
		description?: string;
		serviceId?: string;
		serviceName?: string;
		severity?: string;
		tags?: string[];
	},
	historical: {
		title: string;
		description?: string;
		serviceId?: string;
		serviceName?: string;
		severity?: string;
		tags?: string[];
		rootCauseCategory?: string;
	},
): number {
	let score = 0;

	// Title fuzzy match (40% weight)
	if (current.title && historical.title) {
		const titleSimilarity = stringSimilarity(current.title, historical.title);
		score += titleSimilarity * 40;
	}

	// Description match (10% weight)
	if (current.description && historical.description) {
		const descSimilarity = stringSimilarity(
			current.description,
			historical.description,
		);
		score += descSimilarity * 10;
	}

	// Same service (20% weight)
	if (current.serviceId && historical.serviceId) {
		if (current.serviceId === historical.serviceId) {
			score += 20;
		}
	} else if (current.serviceName && historical.serviceName) {
		if (
			current.serviceName.toLowerCase() === historical.serviceName.toLowerCase()
		) {
			score += 20;
		}
	}

	// Same severity (10% weight)
	if (current.severity && historical.severity) {
		if (current.severity === historical.severity) {
			score += 10;
		}
	}

	// Tag overlap (20% weight)
	if (
		current.tags &&
		current.tags.length > 0 &&
		historical.tags &&
		historical.tags.length > 0
	) {
		const currentTags = new Set(current.tags.map((t) => t.toLowerCase()));
		const historicalTags = new Set(historical.tags.map((t) => t.toLowerCase()));
		const intersection = [...currentTags].filter((t) => historicalTags.has(t));

		if (intersection.length > 0) {
			const tagOverlap =
				intersection.length / Math.max(currentTags.size, historicalTags.size);
			score += tagOverlap * 20;
		}
	}

	return Math.round(Math.min(score, 100));
}

/**
 * Guess root cause category from incident context
 */
export function guessRootCauseCategory(incident: {
	title: string;
	description?: string;
	tags?: string[];
}): string | null {
	const text = `${incident.title} ${incident.description || ""} ${(incident.tags || []).join(" ")}`.toLowerCase();

	// Infrastructure indicators
	if (
		text.includes("memory") ||
		text.includes("cpu") ||
		text.includes("disk") ||
		text.includes("network") ||
		text.includes("kubernetes") ||
		text.includes("k8s") ||
		text.includes("pod") ||
		text.includes("container") ||
		text.includes("node")
	) {
		return "infrastructure";
	}

	// Configuration indicators
	if (
		text.includes("config") ||
		text.includes("environment") ||
		text.includes("setting") ||
		text.includes("variable") ||
		text.includes("permission") ||
		text.includes("secret")
	) {
		return "config";
	}

	// External indicators
	if (
		text.includes("external") ||
		text.includes("third-party") ||
		text.includes("api timeout") ||
		text.includes("upstream") ||
		text.includes("dependency")
	) {
		return "external";
	}

	// Code indicators (often in error messages)
	if (
		text.includes("error") ||
		text.includes("exception") ||
		text.includes("bug") ||
		text.includes("null") ||
		text.includes("undefined") ||
		text.includes("crash")
	) {
		return "code";
	}

	return null;
}

/**
 * Fetch similar incidents from historical data via DataProvider.
 * Applies calculateIncidentSimilarity() to compute real scores,
 * extracts patterns via guessRootCauseCategory(), and builds resolutions.
 */
export async function fetchSimilarIncidents(
	ctx: GatheringContext,
): Promise<GatherResult<SimilarIncidentsContext>> {
	const startTime = Date.now();

	try {
		const { state } = ctx;
		const currentIncident = state.incident;

		if (!currentIncident) {
			logger.debug("No current incident to compare");
			return {
				success: true,
				data: {
					incidents: [],
					patterns: [],
					resolutions: [],
				},
				durationMs: Date.now() - startTime,
			};
		}

		logger.debug("Searching for similar incidents", {
			currentTitle: currentIncident.title,
			serviceId: currentIncident.serviceId,
		});

		// Fetch candidates from DataProvider (resolved/closed incidents from same service)
		const response = await ctx.dataProvider.fetchSimilarIncidents({
			incidentId: currentIncident.incidentId,
			serviceId: currentIncident.serviceId,
			limit: 20,
		});

		// Apply real similarity scoring to each candidate
		const scoredIncidents: SimilarIncidentMatch[] = response.incidents.map(
			(candidate) => {
				const similarity = calculateIncidentSimilarity(
					{
						title: currentIncident.title,
						description: currentIncident.description,
						serviceId: currentIncident.serviceId,
						serviceName: currentIncident.serviceName,
						severity: currentIncident.severity,
						tags: currentIncident.tags,
					},
					{
						title: candidate.title ?? "",
						description: candidate.description,
						serviceId: candidate.serviceId,
						serviceName: candidate.serviceName,
						severity: candidate.severity,
						tags: candidate.tags,
						rootCauseCategory:
							candidate.rootCause ??
							guessRootCauseCategory({
								title: candidate.title ?? "",
								description: candidate.description,
								tags: candidate.tags,
							}) ??
							undefined,
					},
				);

				return { ...candidate, similarity };
			},
		);

		// Filter by MEDIUM threshold (30%) and sort by score descending
		const incidents = scoredIncidents
			.filter((i) => i.similarity >= SIMILARITY_THRESHOLDS.MEDIUM)
			.sort((a, b) => b.similarity - a.similarity);

		// Extract patterns from matching incidents using guessRootCauseCategory
		const patternCounts = new Map<
			string,
			{ count: number; lastOccurrence: string; serviceName?: string }
		>();
		for (const inc of incidents) {
			const category = guessRootCauseCategory({
				title: inc.title ?? "",
				description: inc.description,
				tags: inc.tags,
			});
			if (category) {
				const existing = patternCounts.get(category);
				const occurrence = inc.resolvedAt ?? new Date().toISOString();
				if (existing) {
					existing.count += 1;
					if (occurrence > existing.lastOccurrence) {
						existing.lastOccurrence = occurrence;
					}
				} else {
					patternCounts.set(category, {
						count: 1,
						lastOccurrence: occurrence,
						serviceName: inc.serviceName,
					});
				}
			}
		}

		const patterns: IncidentPattern[] = Array.from(
			patternCounts.entries(),
		).map(([pattern, data]) => ({
			pattern,
			count: data.count,
			lastOccurrence: data.lastOccurrence,
			serviceName: data.serviceName,
		}));

		// Build resolutions from incidents that have resolution or timeToResolve
		const resolutions: PastResolution[] = incidents
			.filter((i) => i.resolution || i.timeToResolve)
			.map((i) => ({
				incidentId: i.incidentId,
				summary: i.resolution ?? `Resolved: ${i.title ?? "Unknown"}`,
				timeToResolve: i.timeToResolve ?? 0,
				rootCauseCategory:
					i.rootCause ??
					guessRootCauseCategory({
						title: i.title ?? "",
						description: i.description,
						tags: i.tags,
					}) ??
					undefined,
			}));

		logger.debug("Found similar incidents", {
			candidates: response.incidents.length,
			aboveThreshold: incidents.length,
			patternsCount: patterns.length,
			resolutionsCount: resolutions.length,
		});

		return {
			success: true,
			data: {
				incidents,
				patterns,
				resolutions,
			},
			durationMs: Date.now() - startTime,
		};
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		logger.error("Failed to fetch similar incidents", { error: errorMessage });
		return {
			success: false,
			data: null,
			error: errorMessage,
			durationMs: Date.now() - startTime,
		};
	}
}

/**
 * Check if an incident match is highly similar (for commander hints)
 */
export function isHighlySimilar(match: SimilarIncidentMatch): boolean {
	return match.similarity >= SIMILARITY_THRESHOLDS.HIGH;
}

/**
 * Get top similar incidents for commander hints
 */
export function getTopSimilarIncidents(
	incidents: SimilarIncidentMatch[],
	limit: number = 3,
): SimilarIncidentMatch[] {
	return incidents
		.filter((i) => i.similarity >= SIMILARITY_THRESHOLDS.MEDIUM)
		.sort((a, b) => b.similarity - a.similarity)
		.slice(0, limit);
}
