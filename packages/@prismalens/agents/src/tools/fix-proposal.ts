import type { StructuredTool } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
	type CodeChange,
	CodeChangeSchema,
	type Recommendation,
	RecommendationSchema,
} from "../types/state.js";

// =============================================================================
// FIX PROPOSAL TOOL
// =============================================================================
// Tool for Surgeon agent to propose fixes and recommendations.
// Does NOT create PRs - only proposes fixes for human review.
// =============================================================================

/**
 * Recommendation storage - collects recommendations formed during investigation.
 * The graph nodes will extract these after the agent completes.
 */
let recommendationStore: Recommendation[] = [];

/**
 * Reset the recommendation store (call at start of each investigation)
 */
export function resetRecommendationStore(): void {
	recommendationStore = [];
}

/**
 * Get all stored recommendations (call after agent completes)
 */
export function getStoredRecommendations(): Recommendation[] {
	return [...recommendationStore];
}

/**
 * Code change input schema
 */
const CodeChangeInputSchema = z.object({
	filePath: z
		.string()
		.describe(
			'Full path to the file from repository root (e.g., "src/services/auth.ts")',
		),
	searchBlock: z
		.string()
		.describe(
			"EXACT content to find in the file - must match character-for-character including whitespace",
		),
	replaceBlock: z
		.string()
		.describe(
			"New content to replace with - use proper formatting and indentation",
		),
	testCase: z
		.string()
		.describe(
			'How to verify this fix works (e.g., "Run `npm test -- auth.test.ts` and verify all tests pass")',
		),
});

/**
 * Recommendation input schema
 */
const RecommendationInputSchema = z.object({
	title: z
		.string()
		.max(100)
		.describe(
			'Clear, actionable title (e.g., "Fix null pointer in auth handler")',
		),
	description: z
		.string()
		.optional()
		.describe(
			"Detailed explanation of the fix and why it addresses the root cause",
		),
	priority: z
		.enum(["critical", "high", "medium", "low"])
		.describe(
			"Priority: critical (production down), high (major impact), medium (degraded), low (minor)",
		),
	category: z
		.enum([
			"code_fix",
			"config_change",
			"rollback",
			"monitoring",
			"investigation",
		])
		.describe(
			"Type: code_fix (patch), config_change (settings), rollback (revert), monitoring (alerts), investigation (more analysis needed)",
		),
	urgency: z
		.enum(["immediate", "short_term", "long_term"])
		.describe(
			"Timeline: immediate (fix now), short_term (within sprint), long_term (backlog)",
		),
	estimatedEffort: z
		.enum(["minutes", "hours", "days"])
		.optional()
		.describe("Rough estimate of implementation time"),
	codeChanges: z
		.array(CodeChangeInputSchema)
		.optional()
		.describe("Specific code changes if this is a code_fix recommendation"),
});

/**
 * Create the propose_fix tool for the Surgeon agent.
 * This tool allows the Surgeon to formally record fix recommendations
 * with optional code changes for review.
 */
export function createProposeFixTool(): StructuredTool {
	return tool(
		async (input) => {
			try {
				// Validate input
				const validated = RecommendationInputSchema.parse(input);

				// Create recommendation
				const recommendation: Recommendation = {
					title: validated.title,
					description: validated.description,
					priority: validated.priority,
					category: validated.category,
					urgency: validated.urgency,
					actionable: true,
					estimatedEffort: validated.estimatedEffort,
					codeChanges: validated.codeChanges as CodeChange[] | undefined,
				};

				// Validate against full schema
				RecommendationSchema.parse(recommendation);

				// Store for later extraction
				recommendationStore.push(recommendation);

				// Build response
				const response: any = {
					status: "recorded",
					recommendation: {
						title: recommendation.title,
						priority: recommendation.priority,
						category: recommendation.category,
						urgency: recommendation.urgency,
					},
					totalRecommendations: recommendationStore.length,
				};

				if (
					recommendation.codeChanges &&
					recommendation.codeChanges.length > 0
				) {
					response.codeChanges = {
						count: recommendation.codeChanges.length,
						files: recommendation.codeChanges.map((c) => c.filePath),
					};
					response.guidance =
						"Code changes recorded. These will be presented to humans for review - NOT automatically applied.";
				} else {
					response.guidance =
						recommendation.category === "code_fix"
							? "Consider adding specific codeChanges for easier implementation."
							: "Recommendation recorded for human review.";
				}

				return JSON.stringify(response, null, 2);
			} catch (error: any) {
				if (error.name === "ZodError") {
					return JSON.stringify(
						{
							status: "error",
							error: "Invalid recommendation format",
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
			name: "propose_fix",
			description: `Propose a fix or recommendation based on the root cause analysis. Use this to record actionable solutions.

IMPORTANT: This tool does NOT create PRs or apply changes. It only records proposals for human review.

WHEN TO USE:
- After Detective has identified a root cause with sufficient confidence (70%+)
- When you have a clear, actionable solution
- You can propose multiple fixes of different types

CATEGORY SELECTION:
- code_fix: Specific code change needed. Include codeChanges array with exact search/replace blocks.
- config_change: Environment variable, feature flag, or setting needs updating
- rollback: Previous deployment should be reverted
- monitoring: New alerts or dashboards should be added
- investigation: More analysis needed before fixing

CODE CHANGES FORMAT:
When using code_fix category, include codeChanges array:
- searchBlock: MUST be EXACT match of current code (copy-paste from source)
- replaceBlock: The corrected code
- testCase: How to verify the fix

PRIORITY GUIDELINES:
- critical: Production down, data loss risk, security vulnerability
- high: Major feature broken, significant user impact
- medium: Degraded performance, partial functionality loss
- low: Minor issue, cosmetic, edge case

URGENCY GUIDELINES:
- immediate: Deploy ASAP, hotfix needed
- short_term: Fix within current sprint
- long_term: Add to backlog, plan for later`,
			schema: RecommendationInputSchema,
		},
	);
}

/**
 * Create a validate_code_change tool for verifying proposed changes
 */
export function createValidateCodeChangeTool(): StructuredTool {
	return tool(
		async ({
			recommendationIndex,
			codeChangeIndex,
			searchFound,
			syntaxValid,
			notes,
		}) => {
			if (
				recommendationIndex < 0 ||
				recommendationIndex >= recommendationStore.length
			) {
				return JSON.stringify({
					status: "error",
					error: `Invalid recommendation index. Valid range: 0-${recommendationStore.length - 1}`,
				});
			}

			const recommendation = recommendationStore[recommendationIndex];

			if (
				!recommendation.codeChanges ||
				recommendation.codeChanges.length === 0
			) {
				return JSON.stringify({
					status: "error",
					error: "This recommendation has no code changes to validate",
				});
			}

			if (
				codeChangeIndex < 0 ||
				codeChangeIndex >= recommendation.codeChanges.length
			) {
				return JSON.stringify({
					status: "error",
					error: `Invalid code change index. Valid range: 0-${recommendation.codeChanges.length - 1}`,
				});
			}

			// Store validation notes in the test case field (append)
			const codeChange = recommendation.codeChanges[codeChangeIndex];
			const validationStatus =
				searchFound && syntaxValid ? "VALIDATED" : "NEEDS_REVIEW";
			const validationNote = `[${validationStatus}] searchFound: ${searchFound}, syntaxValid: ${syntaxValid}${notes ? `. Notes: ${notes}` : ""}`;

			codeChange.testCase = `${codeChange.testCase}\n${validationNote}`;

			return JSON.stringify({
				status: "validated",
				validationStatus,
				codeChange: {
					filePath: codeChange.filePath,
					searchFound,
					syntaxValid,
				},
				notes,
			});
		},
		{
			name: "validate_code_change",
			description:
				"Validate a proposed code change by checking if the search block exists in the target file and if the replacement syntax is valid.",
			schema: z.object({
				recommendationIndex: z
					.number()
					.describe("Index of the recommendation (0-based)"),
				codeChangeIndex: z
					.number()
					.describe(
						"Index of the code change within the recommendation (0-based)",
					),
				searchFound: z
					.boolean()
					.describe("Whether the searchBlock was found in the file"),
				syntaxValid: z
					.boolean()
					.describe("Whether the replaceBlock has valid syntax"),
				notes: z.string().optional().describe("Any notes about the validation"),
			}),
		},
	);
}

/**
 * Create a suggest_rollback tool for quick rollback recommendations
 */
export function createSuggestRollbackTool(): StructuredTool {
	return tool(
		async ({ deploymentId, commitSha, service, reason }) => {
			const recommendation: Recommendation = {
				title: `Rollback ${service} to previous deployment`,
				description: `Recommend rolling back ${service} to ${deploymentId || commitSha || "previous version"}. Reason: ${reason}`,
				priority: "high",
				category: "rollback",
				urgency: "immediate",
				actionable: true,
			};

			recommendationStore.push(recommendation);

			return JSON.stringify({
				status: "recorded",
				recommendation: {
					title: recommendation.title,
					priority: recommendation.priority,
					urgency: recommendation.urgency,
					rollbackTarget: deploymentId || commitSha,
					service,
				},
				guidance:
					"Rollback recommendation recorded. Human approval required before executing.",
				totalRecommendations: recommendationStore.length,
			});
		},
		{
			name: "suggest_rollback",
			description:
				"Quickly suggest rolling back a deployment when evidence points to a recent change causing the issue.",
			schema: z.object({
				service: z.string().describe("Name of the service to rollback"),
				deploymentId: z
					.string()
					.optional()
					.describe("Specific deployment ID to rollback to"),
				commitSha: z
					.string()
					.optional()
					.describe("Specific commit SHA to rollback to"),
				reason: z.string().describe("Brief reason for rollback recommendation"),
			}),
		},
	);
}

/**
 * Create all fix-proposal tools for Surgeon agent
 */
export function createSurgeonTools(): StructuredTool[] {
	return [
		createProposeFixTool(),
		createValidateCodeChangeTool(),
		createSuggestRollbackTool(),
	];
}
