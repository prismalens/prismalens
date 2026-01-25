import type { StructuredTool } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { type Hypothesis, HypothesisSchema } from "../types/state.js";

// =============================================================================
// HYPOTHESIS TOOL
// =============================================================================
// Tool for Detective agent to form and validate root cause hypotheses.
// This tool stores hypotheses in a way that can be collected by the graph.
// =============================================================================

/**
 * Hypothesis storage - collects hypotheses formed during investigation.
 * The graph nodes will extract these after the agent completes.
 */
let hypothesisStore: Hypothesis[] = [];

/**
 * Reset the hypothesis store (call at start of each investigation)
 */
export function resetHypothesisStore(): void {
	hypothesisStore = [];
}

/**
 * Get all stored hypotheses (call after agent completes)
 */
export function getStoredHypotheses(): Hypothesis[] {
	return [...hypothesisStore];
}

/**
 * Hypothesis input schema - what the Detective provides
 */
const HypothesisInputSchema = z.object({
	claim: z
		.string()
		.describe(
			"The root cause hypothesis - a clear statement of what you believe caused the issue",
		),
	confidence: z
		.number()
		.min(0)
		.max(100)
		.describe(
			"Your confidence level (0-100). Use: 90-100 for certainty with strong evidence, 70-89 for likely with good evidence, 50-69 for possible with some evidence, below 50 for speculation",
		),
	evidence: z
		.array(z.string())
		.min(1)
		.describe(
			'List of evidence supporting this hypothesis (e.g., "Error log shows null pointer at line 42", "Deployment at 14:32 coincides with alert trigger")',
		),
	category: z
		.enum(["code", "config", "infrastructure", "external", "unknown"])
		.describe(
			"Category of root cause: code (bug/logic error), config (misconfiguration), infrastructure (resource/network), external (3rd party/API), unknown",
		),
});

/**
 * Create the form_hypothesis tool for the Detective agent.
 * This tool allows the Detective to formally record root cause hypotheses
 * with supporting evidence and confidence levels.
 */
export function createHypothesisTool(): StructuredTool {
	return tool(
		async (input) => {
			try {
				// Validate input
				const validated = HypothesisInputSchema.parse(input);

				// Create hypothesis with timestamp
				const hypothesis: Hypothesis = {
					...validated,
					timestamp: new Date().toISOString(),
				};

				// Validate against full schema
				HypothesisSchema.parse(hypothesis);

				// Store for later extraction
				hypothesisStore.push(hypothesis);

				// Return confirmation with guidance
				const confidenceLevel =
					validated.confidence >= 90
						? "HIGH"
						: validated.confidence >= 70
							? "MEDIUM"
							: validated.confidence >= 50
								? "LOW"
								: "VERY LOW";

				return JSON.stringify(
					{
						status: "recorded",
						hypothesis: {
							claim: validated.claim,
							confidence: validated.confidence,
							confidenceLevel,
							category: validated.category,
							evidenceCount: validated.evidence.length,
						},
						guidance:
							validated.confidence < 70
								? "Consider gathering more evidence to increase confidence before finalizing."
								: validated.confidence >= 90
									? "High confidence hypothesis recorded. Ready for fix proposal phase."
									: "Good hypothesis recorded. Consider if more evidence would strengthen the case.",
						totalHypotheses: hypothesisStore.length,
					},
					null,
					2,
				);
			} catch (error) {
				if (error instanceof z.ZodError) {
					return JSON.stringify(
						{
							status: "error",
							error: "Invalid hypothesis format",
							details: error.errors,
						},
						null,
						2,
					);
				}
				return JSON.stringify(
					{
						status: "error",
						error: error instanceof Error ? error.message : String(error),
					},
					null,
					2,
				);
			}
		},
		{
			name: "form_hypothesis",
			description: `Form a root cause hypothesis with supporting evidence. Use this to record your analysis conclusions.

WHEN TO USE:
- After gathering and analyzing context from logs, code, metrics, etc.
- When you have enough evidence to propose a likely root cause
- You can form multiple hypotheses with different confidence levels

CONFIDENCE GUIDELINES:
- 90-100: Definitive - You have direct evidence (error message, stack trace, config diff)
- 70-89: Likely - Strong circumstantial evidence, timing correlation, similar past incidents
- 50-69: Possible - Some supporting evidence but gaps remain
- Below 50: Speculation - Needs more investigation before acting

CATEGORY SELECTION:
- code: Bug, logic error, null pointer, race condition, memory leak
- config: Wrong settings, missing env var, feature flag, threshold misconfiguration
- infrastructure: Resource exhaustion, network issues, disk full, container limits
- external: Third-party API failure, dependency outage, upstream service issue
- unknown: Cannot determine category with available evidence`,
			schema: HypothesisInputSchema,
		},
	);
}

/**
 * Create an evaluate_hypothesis tool for re-assessing hypotheses
 */
export function createEvaluateHypothesisTool(): StructuredTool {
	return tool(
		async ({
			hypothesisIndex,
			newConfidence,
			additionalEvidence,
			rejected,
			rejectionReason,
		}) => {
			if (hypothesisIndex < 0 || hypothesisIndex >= hypothesisStore.length) {
				return JSON.stringify({
					status: "error",
					error: `Invalid hypothesis index. Valid range: 0-${hypothesisStore.length - 1}`,
				});
			}

			const hypothesis = hypothesisStore[hypothesisIndex];

			if (rejected) {
				// Mark as rejected by setting confidence to 0
				hypothesis.confidence = 0;
				hypothesis.evidence.push(
					`REJECTED: ${rejectionReason || "No reason provided"}`,
				);

				return JSON.stringify({
					status: "rejected",
					hypothesis: {
						claim: hypothesis.claim,
						originalConfidence: hypothesis.confidence,
						reason: rejectionReason,
					},
				});
			}

			// Update confidence and add evidence
			if (newConfidence !== undefined) {
				hypothesis.confidence = newConfidence;
			}

			if (additionalEvidence && additionalEvidence.length > 0) {
				hypothesis.evidence.push(...additionalEvidence);
			}

			return JSON.stringify({
				status: "updated",
				hypothesis: {
					claim: hypothesis.claim,
					confidence: hypothesis.confidence,
					evidenceCount: hypothesis.evidence.length,
				},
			});
		},
		{
			name: "evaluate_hypothesis",
			description:
				"Re-evaluate an existing hypothesis based on new evidence. Use to update confidence or reject a hypothesis.",
			schema: z.object({
				hypothesisIndex: z
					.number()
					.describe("Index of the hypothesis to evaluate (0-based)"),
				newConfidence: z
					.number()
					.min(0)
					.max(100)
					.optional()
					.describe("Updated confidence level"),
				additionalEvidence: z
					.array(z.string())
					.optional()
					.describe("New evidence to add"),
				rejected: z
					.boolean()
					.optional()
					.describe("Set to true to reject this hypothesis"),
				rejectionReason: z
					.string()
					.optional()
					.describe("Reason for rejecting the hypothesis"),
			}),
		},
	);
}

// =============================================================================
// CHANGE CORRELATION TOOL
// =============================================================================
// Tool for correlating incidents with recent changes (deployments, config, code).
// Industry data: 60-90% of outages are caused by changes.
// =============================================================================

/**
 * Change correlation storage - collects correlations found during investigation.
 */
let changeCorrelationStore: ChangeCorrelation[] = [];

export interface ChangeCorrelation {
	type: "deployment" | "config_change" | "code_change" | "infrastructure";
	id: string;
	timestamp: string;
	timeDelta: string;
	riskScore: number;
	details: Record<string, unknown>;
	riskFactors: string[];
}

/**
 * Reset the change correlation store
 */
export function resetChangeCorrelationStore(): void {
	changeCorrelationStore = [];
}

/**
 * Get all stored change correlations
 */
export function getStoredChangeCorrelations(): ChangeCorrelation[] {
	return [...changeCorrelationStore];
}

const ChangeCorrelationInputSchema = z.object({
	incidentTime: z
		.string()
		.describe("ISO timestamp when the incident started"),
	changes: z
		.array(
			z.object({
				type: z
					.enum(["deployment", "config_change", "code_change", "infrastructure"])
					.describe("Type of change"),
				id: z.string().describe("Unique identifier for the change"),
				timestamp: z.string().describe("ISO timestamp of the change"),
				details: z
					.record(z.unknown())
					.describe("Additional details about the change"),
				riskFactors: z
					.array(z.string())
					.optional()
					.describe("Known risk factors for this change"),
			}),
		)
		.describe("List of changes to correlate with the incident"),
});

/**
 * Create the correlate_with_changes tool for the Detective agent.
 * Based on BigPanda's Root Cause Changes pattern.
 */
export function createChangeCorrelationTool(): StructuredTool {
	return tool(
		async (input) => {
			try {
				const { incidentTime, changes } = ChangeCorrelationInputSchema.parse(input);
				const incidentDate = new Date(incidentTime);

				const correlatedChanges: ChangeCorrelation[] = changes.map((change) => {
					const changeDate = new Date(change.timestamp);
					const deltaMs = incidentDate.getTime() - changeDate.getTime();
					const deltaHours = deltaMs / (1000 * 60 * 60);

					// Calculate risk score based on timing and factors
					let riskScore = 0;
					const riskFactors: string[] = change.riskFactors || [];

					// Timing-based scoring
					if (deltaHours > 0 && deltaHours <= 1) {
						riskScore += 30;
						riskFactors.push("Change within 1 hour before incident");
					} else if (deltaHours > 1 && deltaHours <= 4) {
						riskScore += 20;
						riskFactors.push("Change within 4 hours before incident");
					} else if (deltaHours > 4 && deltaHours <= 24) {
						riskScore += 10;
						riskFactors.push("Change within 24 hours before incident");
					}

					// Type-based scoring
					if (change.type === "deployment") {
						riskScore += 20;
						riskFactors.push("Deployment change");
					} else if (change.type === "config_change") {
						riskScore += 15;
						riskFactors.push("Configuration change");
					} else if (change.type === "infrastructure") {
						riskScore += 25;
						riskFactors.push("Infrastructure change");
					}

					// Format time delta
					const timeDelta =
						deltaHours > 0
							? `-${deltaHours.toFixed(1)} hours`
							: `+${Math.abs(deltaHours).toFixed(1)} hours`;

					const correlation: ChangeCorrelation = {
						type: change.type,
						id: change.id,
						timestamp: change.timestamp,
						timeDelta,
						riskScore: Math.min(100, riskScore),
						details: change.details,
						riskFactors,
					};

					changeCorrelationStore.push(correlation);
					return correlation;
				});

				// Sort by risk score
				correlatedChanges.sort((a, b) => b.riskScore - a.riskScore);

				const mostLikely = correlatedChanges[0];

				return JSON.stringify(
					{
						status: "correlated",
						incidentTime,
						totalChanges: correlatedChanges.length,
						correlatedChanges,
						mostLikelyChange: mostLikely
							? {
									id: mostLikely.id,
									type: mostLikely.type,
									riskScore: mostLikely.riskScore,
									timeDelta: mostLikely.timeDelta,
								}
							: null,
						guidance:
							mostLikely && mostLikely.riskScore >= 50
								? `High correlation with ${mostLikely.type} ${mostLikely.id}. Consider this as primary suspect.`
								: "No strong change correlation found. May be a latent bug or external factor.",
					},
					null,
					2,
				);
			} catch (error) {
				return JSON.stringify({
					status: "error",
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
		{
			name: "correlate_with_changes",
			description: `Correlate an incident with recent changes to identify change-induced issues.
60-90% of outages are caused by changes.

USE THIS TOOL:
- After getting deployment history from Cartographer
- To score which change most likely caused the incident
- To identify timing correlations between changes and incidents

SCORING:
- Changes within 1 hour: +30 points
- Changes within 4 hours: +20 points
- Deployments: +20 points
- Config changes: +15 points
- Infrastructure changes: +25 points

High scores (50+) indicate strong correlation.`,
			schema: ChangeCorrelationInputSchema,
		},
	);
}

// =============================================================================
// INCIDENT SIMILARITY TOOL
// =============================================================================
// Tool for finding historically similar incidents to leverage past resolutions.
// Based on BigPanda's 30% similarity threshold pattern.
// =============================================================================

/**
 * Similar incident record
 */
export interface SimilarIncident {
	incidentId: string;
	date: string;
	similarity: number;
	title: string;
	service?: string;
	matchingFactors: string[];
	resolution?: {
		type: string;
		summary: string;
		timeToResolve?: string;
		fixCommit?: string;
	};
}

let similarIncidentStore: SimilarIncident[] = [];

/**
 * Reset the similar incident store
 */
export function resetSimilarIncidentStore(): void {
	similarIncidentStore = [];
}

/**
 * Get all stored similar incidents
 */
export function getStoredSimilarIncidents(): SimilarIncident[] {
	return [...similarIncidentStore];
}

const SimilarIncidentInputSchema = z.object({
	currentIncident: z.object({
		errorPattern: z.string().describe("Normalized error message pattern"),
		service: z.string().optional().describe("Service name"),
		severity: z.string().optional().describe("Severity level"),
		category: z.string().optional().describe("Category (code, config, etc.)"),
	}),
	historicalIncidents: z
		.array(
			z.object({
				incidentId: z.string(),
				date: z.string(),
				title: z.string(),
				errorPattern: z.string().optional(),
				service: z.string().optional(),
				severity: z.string().optional(),
				category: z.string().optional(),
				resolution: z
					.object({
						type: z.string(),
						summary: z.string(),
						timeToResolve: z.string().optional(),
						fixCommit: z.string().optional(),
					})
					.optional(),
			}),
		)
		.describe("List of historical incidents to compare against"),
});

/**
 * Create the find_similar_incidents tool for the Detective agent.
 * Based on BigPanda's incident similarity pattern.
 */
export function createSimilarIncidentTool(): StructuredTool {
	return tool(
		async (input) => {
			try {
				const { currentIncident, historicalIncidents } =
					SimilarIncidentInputSchema.parse(input);

				const similarIncidents: SimilarIncident[] = historicalIncidents
					.map((historical) => {
						let similarity = 0;
						const matchingFactors: string[] = [];

						// Error pattern match (40%)
						if (
							historical.errorPattern &&
							currentIncident.errorPattern.toLowerCase().includes(
								historical.errorPattern.toLowerCase().slice(0, 20),
							)
						) {
							similarity += 40;
							matchingFactors.push("Similar error pattern");
						}

						// Service match (20%)
						if (
							historical.service &&
							historical.service === currentIncident.service
						) {
							similarity += 20;
							matchingFactors.push("Same service");
						}

						// Category match (20%)
						if (
							historical.category &&
							historical.category === currentIncident.category
						) {
							similarity += 20;
							matchingFactors.push("Same category");
						}

						// Severity match (10%)
						if (
							historical.severity &&
							historical.severity === currentIncident.severity
						) {
							similarity += 10;
							matchingFactors.push("Same severity");
						}

						// Title pattern match (10%)
						const currentWords = currentIncident.errorPattern
							.toLowerCase()
							.split(/\s+/);
						const historicalWords = historical.title.toLowerCase().split(/\s+/);
						const commonWords = currentWords.filter((w) =>
							historicalWords.includes(w),
						);
						if (commonWords.length >= 2) {
							similarity += 10;
							matchingFactors.push("Matching keywords in title");
						}

						return {
							incidentId: historical.incidentId,
							date: historical.date,
							similarity,
							title: historical.title,
							service: historical.service,
							matchingFactors,
							resolution: historical.resolution,
						};
					})
					.filter((i) => i.similarity >= 30) // BigPanda's 30% threshold
					.sort((a, b) => b.similarity - a.similarity)
					.slice(0, 5); // Top 5

				similarIncidentStore.push(...similarIncidents);

				const bestMatch = similarIncidents[0];

				return JSON.stringify(
					{
						status: "analyzed",
						totalAnalyzed: historicalIncidents.length,
						similarIncidents,
						patterns:
							similarIncidents.length >= 3
								? [
										{
											observation: `${similarIncidents.length} similar incidents found`,
											suggestion: "This may be a recurring issue",
										},
									]
								: [],
						recommendedAction: bestMatch
							? bestMatch.similarity >= 70
								? `Strong match: Review resolution from ${bestMatch.incidentId} (${bestMatch.similarity}% similar)`
								: `Moderate match: Consider ${bestMatch.incidentId} (${bestMatch.similarity}% similar) for reference`
							: "No similar incidents found. This may be a new issue type.",
					},
					null,
					2,
				);
			} catch (error) {
				return JSON.stringify({
					status: "error",
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
		{
			name: "find_similar_incidents",
			description: `Find historically similar incidents to leverage past resolutions.

USE THIS TOOL:
- When you have incident data and want to find similar past cases
- To identify recurring issues
- To leverage past resolutions for faster MTTR

SIMILARITY SCORING:
- Error pattern match: +40%
- Same service: +20%
- Same category: +20%
- Same severity: +10%
- Matching keywords: +10%

THRESHOLDS:
- 70%+: Strong match - very likely same issue
- 50-69%: Moderate match - worth investigating
- 30-49%: Weak match - possible patterns
- Below 30%: Not similar`,
			schema: SimilarIncidentInputSchema,
		},
	);
}

/**
 * Create all hypothesis-related tools for Detective agent
 */
export function createDetectiveTools(): StructuredTool[] {
	return [
		createHypothesisTool(),
		createEvaluateHypothesisTool(),
		createChangeCorrelationTool(),
		createSimilarIncidentTool(),
	];
}
