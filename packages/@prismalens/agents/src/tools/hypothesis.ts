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
			} catch (error: any) {
				if (error.name === "ZodError") {
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
						error: error.message,
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

/**
 * Create all hypothesis-related tools for Detective agent
 */
export function createDetectiveTools(): StructuredTool[] {
	return [createHypothesisTool(), createEvaluateHypothesisTool()];
}
