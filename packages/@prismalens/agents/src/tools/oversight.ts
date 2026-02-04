// =============================================================================
// OVERSIGHT TOOLS
// =============================================================================
// Tools for the Adversary agent's strategic oversight responsibilities.
// These tools enable scope alignment checking, scope creep detection, and
// progress auditing to keep investigations focused on the original incident.
// =============================================================================

import type { StructuredTool } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// =============================================================================
// OVERSIGHT STORE
// =============================================================================

/**
 * Scope alignment check result
 */
export interface ScopeAlignmentResult {
	aligned: boolean;
	score: number; // 0-100
	issues: string[];
	recommendations: string[];
	timestamp: string;
}

/**
 * Scope creep flag
 */
export interface ScopeCreepFlag {
	severity: "low" | "medium" | "high";
	description: string;
	affectedAgent?: string;
	suggestedAction: string;
	timestamp: string;
}

/**
 * Progress audit result
 */
export interface ProgressAuditResult {
	progressScore: number; // 0-100
	stalled: boolean;
	recentActivity: string[];
	recommendations: string[];
	timestamp: string;
}

let scopeAlignmentResults: ScopeAlignmentResult[] = [];
let scopeCreepFlags: ScopeCreepFlag[] = [];
let progressAuditResults: ProgressAuditResult[] = [];

/**
 * Reset all oversight stores (call at start of each agent invocation)
 */
export function resetOversightStore(): void {
	scopeAlignmentResults = [];
	scopeCreepFlags = [];
	progressAuditResults = [];
}

/**
 * Get stored scope alignment results
 */
export function getScopeAlignmentResults(): ScopeAlignmentResult[] {
	return [...scopeAlignmentResults];
}

/**
 * Get stored scope creep flags
 */
export function getScopeCreepFlags(): ScopeCreepFlag[] {
	return [...scopeCreepFlags];
}

/**
 * Get stored progress audit results
 */
export function getProgressAuditResults(): ProgressAuditResult[] {
	return [...progressAuditResults];
}

// =============================================================================
// SCOPE ALIGNMENT CHECK TOOL
// =============================================================================

const ScopeAlignmentInputSchema = z.object({
	hypothesisClaim: z.string().describe("The current hypothesis being validated"),
	incidentTitle: z.string().describe("Title of the original incident"),
	incidentSymptoms: z
		.array(z.string())
		.describe("Original symptoms from the incident"),
	affectedServices: z
		.array(z.string())
		.describe("Services affected in the original incident"),
	hypothesisExplains: z
		.array(z.string())
		.describe("Symptoms the hypothesis claims to explain"),
	hypothesisService: z
		.string()
		.optional()
		.describe("Service the hypothesis relates to"),
});

/**
 * Create the scope_alignment_check tool.
 * Validates that the current hypothesis addresses the original incident.
 */
export function createScopeAlignmentTool(): StructuredTool {
	return tool(
		async (input) => {
			try {
				const validated = ScopeAlignmentInputSchema.parse(input);

				const issues: string[] = [];
				const recommendations: string[] = [];
				let score = 100;

				// Check if hypothesis explains original symptoms
				const unexplainedSymptoms = validated.incidentSymptoms.filter(
					(symptom) =>
						!validated.hypothesisExplains.some(
							(explained) =>
								symptom.toLowerCase().includes(explained.toLowerCase()) ||
								explained.toLowerCase().includes(symptom.toLowerCase()),
						),
				);

				if (unexplainedSymptoms.length > 0) {
					score -= unexplainedSymptoms.length * 15;
					issues.push(
						`Hypothesis does not explain ${unexplainedSymptoms.length} original symptom(s): ${unexplainedSymptoms.join(", ")}`,
					);
					recommendations.push(
						"Revise hypothesis to account for unexplained symptoms or investigate if they are separate issues",
					);
				}

				// Check service alignment
				if (
					validated.hypothesisService &&
					!validated.affectedServices.includes(validated.hypothesisService)
				) {
					score -= 25;
					issues.push(
						`Hypothesis relates to ${validated.hypothesisService} which is not in the affected services list`,
					);
					recommendations.push(
						"Verify the service connection or investigate why the affected service was not identified",
					);
				}

				// Check if hypothesis addresses the incident title keywords
				const titleKeywords = validated.incidentTitle
					.toLowerCase()
					.split(/\s+/)
					.filter((w) => w.length > 3);
				const claimLower = validated.hypothesisClaim.toLowerCase();
				const matchedKeywords = titleKeywords.filter((kw) =>
					claimLower.includes(kw),
				);

				if (matchedKeywords.length < titleKeywords.length * 0.3) {
					score -= 20;
					issues.push(
						"Hypothesis does not reference key terms from incident title",
					);
					recommendations.push(
						"Ensure hypothesis directly addresses the core issue mentioned in the incident",
					);
				}

				const aligned = score >= 60;

				const result: ScopeAlignmentResult = {
					aligned,
					score: Math.max(0, score),
					issues,
					recommendations,
					timestamp: new Date().toISOString(),
				};

				scopeAlignmentResults.push(result);

				return JSON.stringify(
					{
						status: aligned ? "aligned" : "misaligned",
						...result,
						guidance: aligned
							? "Hypothesis appears to address the original incident. Continue with analysis."
							: "Hypothesis may have drifted from the original incident. Consider the recommendations above.",
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
			name: "scope_alignment_check",
			description: `Validate that the current hypothesis addresses the original incident.

USE THIS TO:
- Check if the hypothesis explains the original symptoms
- Verify the hypothesis relates to the affected services
- Ensure we haven't drifted from the original problem

WHEN TO USE:
- Before finalizing a hypothesis
- When findings seem to be going in a different direction
- After multiple handoff iterations

SCORING:
- 80-100: Well aligned with original incident
- 60-79: Partially aligned, some gaps
- Below 60: Significant drift from original issue`,
			schema: ScopeAlignmentInputSchema,
		},
	);
}

// =============================================================================
// FLAG SCOPE CREEP TOOL
// =============================================================================

const FlagScopeCreepInputSchema = z.object({
	description: z.string().describe("Description of the scope creep issue"),
	severity: z
		.enum(["low", "medium", "high"])
		.describe(
			"Severity: low (minor tangent), medium (significant deviation), high (completely off track)",
		),
	affectedAgent: z
		.string()
		.optional()
		.describe("Which agent is causing the scope creep"),
	evidence: z
		.array(z.string())
		.optional()
		.describe("Evidence supporting the scope creep claim"),
	suggestedAction: z
		.string()
		.describe("Recommended action to address the scope creep"),
});

/**
 * Create the flag_scope_creep tool.
 * Marks investigation as deviating from the original incident.
 */
export function createFlagScopeCreepTool(): StructuredTool {
	return tool(
		async (input) => {
			try {
				const validated = FlagScopeCreepInputSchema.parse(input);

				const flag: ScopeCreepFlag = {
					severity: validated.severity,
					description: validated.description,
					affectedAgent: validated.affectedAgent,
					suggestedAction: validated.suggestedAction,
					timestamp: new Date().toISOString(),
				};

				scopeCreepFlags.push(flag);

				return JSON.stringify(
					{
						status: "flagged",
						...flag,
						evidence: validated.evidence,
						guidance:
							validated.severity === "high"
								? "CRITICAL: Investigation has drifted significantly. Recommend stopping current line of inquiry and refocusing on original incident."
								: validated.severity === "medium"
									? "Investigation is veering off course. Consider redirecting efforts to original symptoms."
									: "Minor tangent detected. May be worth noting but not blocking.",
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
			name: "flag_scope_creep",
			description: `Mark investigation as deviating from the original incident scope.

USE THIS WHEN:
- Gatherers are investigating services not related to the incident
- Hypothesis is drifting to unrelated issues
- Multiple handoffs are producing unrelated findings
- Detective is pursuing tangential leads

SEVERITY LEVELS:
- low: Minor tangent, may be worth exploring
- medium: Significant deviation, should redirect soon
- high: Completely off track, stop and refocus

This flag will be visible to the supervisor for corrective action.`,
			schema: FlagScopeCreepInputSchema,
		},
	);
}

// =============================================================================
// PROGRESS AUDIT TOOL
// =============================================================================

const ProgressAuditInputSchema = z.object({
	recentFindings: z
		.array(
			z.object({
				summary: z.string(),
				relevance: z.number().min(0).max(100),
				source: z.string(),
			}),
		)
		.describe("Recent findings to audit"),
	handoffCount: z.number().describe("Number of handoffs so far"),
	hypothesisConfidence: z
		.number()
		.min(0)
		.max(100)
		.optional()
		.describe("Current best hypothesis confidence"),
	incidentSeverity: z
		.enum(["critical", "high", "medium", "low", "info"])
		.optional()
		.describe("Incident severity for context"),
});

/**
 * Create the progress_audit tool.
 * Assesses if the investigation is making meaningful progress toward resolution.
 */
export function createProgressAuditTool(): StructuredTool {
	return tool(
		async (input) => {
			try {
				const validated = ProgressAuditInputSchema.parse(input);

				const recommendations: string[] = [];
				let progressScore = 50; // Start neutral
				let stalled = false;

				// Analyze recent findings
				const recentActivity: string[] = [];
				const highRelevanceCount = validated.recentFindings.filter(
					(f) => f.relevance >= 70,
				).length;
				const lowRelevanceCount = validated.recentFindings.filter(
					(f) => f.relevance < 30,
				).length;

				if (highRelevanceCount >= 2) {
					progressScore += 20;
					recentActivity.push(
						`${highRelevanceCount} high-relevance findings in recent results`,
					);
				}

				if (lowRelevanceCount > highRelevanceCount) {
					progressScore -= 15;
					recentActivity.push(
						"Majority of recent findings have low relevance",
					);
					recommendations.push(
						"Consider refocusing investigation on higher-relevance areas",
					);
				}

				// Check handoff efficiency
				if (validated.handoffCount >= 3 && highRelevanceCount === 0) {
					progressScore -= 20;
					stalled = true;
					recentActivity.push(
						`${validated.handoffCount} handoffs with no high-relevance findings`,
					);
					recommendations.push(
						"Investigation appears stalled. Consider forming hypothesis with current data or changing approach",
					);
				}

				// Check hypothesis confidence progression
				if (validated.hypothesisConfidence !== undefined) {
					if (validated.hypothesisConfidence >= 70) {
						progressScore += 30;
						recentActivity.push(
							`Strong hypothesis formed (${validated.hypothesisConfidence}% confidence)`,
						);
					} else if (validated.hypothesisConfidence < 40) {
						progressScore -= 10;
						recentActivity.push(
							`Hypothesis confidence still low (${validated.hypothesisConfidence}%)`,
						);
						if (validated.handoffCount >= 4) {
							recommendations.push(
								"May need to accept uncertainty or investigate different angle",
							);
						}
					}
				}

				// Consider severity vs. effort
				if (
					validated.incidentSeverity === "critical" &&
					validated.handoffCount >= 4 &&
					(validated.hypothesisConfidence ?? 0) < 70
				) {
					recommendations.push(
						"Critical incident with slow progress. Consider escalating or parallel investigation tracks",
					);
				}

				const result: ProgressAuditResult = {
					progressScore: Math.max(0, Math.min(100, progressScore)),
					stalled,
					recentActivity,
					recommendations,
					timestamp: new Date().toISOString(),
				};

				progressAuditResults.push(result);

				return JSON.stringify(
					{
						status: stalled ? "stalled" : "progressing",
						...result,
						guidance: stalled
							? "Investigation has stalled. Recommend reviewing approach or finalizing with available data."
							: progressScore >= 70
								? "Good progress. Continue investigation."
								: "Moderate progress. Consider the recommendations above.",
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
			name: "progress_audit",
			description: `Assess if the investigation is making meaningful progress toward resolution.

USE THIS TO:
- Evaluate if recent handoffs are producing useful results
- Check if hypothesis confidence is improving
- Determine if investigation is stalled

SCORING:
- 70-100: Good progress, continue
- 40-69: Moderate progress, consider adjustments
- Below 40: Stalled, recommend changes

This helps prevent infinite loops of unproductive investigation.`,
			schema: ProgressAuditInputSchema,
		},
	);
}

// =============================================================================
// CREATE ALL OVERSIGHT TOOLS
// =============================================================================

/**
 * Create all oversight tools for the Adversary agent.
 */
export function createOversightTools(): StructuredTool[] {
	return [
		createScopeAlignmentTool(),
		createFlagScopeCreepTool(),
		createProgressAuditTool(),
	];
}
