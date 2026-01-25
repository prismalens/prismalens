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
			} catch (error) {
				if (error instanceof z.ZodError) {
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
						error: error instanceof Error ? error.message : String(error),
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
 * Runbook search result storage - collects runbook matches during investigation.
 */
let runbookStore: Array<{
	query: string;
	results: Array<{
		title: string;
		source: string;
		relevance: number;
		summary: string;
		sections: Array<{
			name: string;
			steps: string[];
		}>;
	}>;
}> = [];

/**
 * Reset the runbook store (call at start of each investigation)
 */
export function resetRunbookStore(): void {
	runbookStore = [];
}

/**
 * Get all stored runbook searches (call after agent completes)
 */
export function getStoredRunbooks(): typeof runbookStore {
	return [...runbookStore];
}

/**
 * Risk assessment storage - collects risk assessments during investigation.
 */
let riskAssessmentStore: Array<{
	changeTitle: string;
	overallScore: number;
	level: "low" | "medium" | "high" | "critical";
	factors: Record<string, { score: number; reasoning: string }>;
	mitigations: Array<{ action: string; reducesRiskBy: number }>;
	approvalRequired: string;
}> = [];

/**
 * Reset the risk assessment store (call at start of each investigation)
 */
export function resetRiskAssessmentStore(): void {
	riskAssessmentStore = [];
}

/**
 * Get all stored risk assessments (call after agent completes)
 */
export function getStoredRiskAssessments(): typeof riskAssessmentStore {
	return [...riskAssessmentStore];
}

/**
 * Create a lookup_runbook tool for searching runbooks and documentation
 */
export function createLookupRunbookTool(): StructuredTool {
	return tool(
		async ({ query, category, service }) => {
			// Simulate runbook search - in production this would query actual runbook sources
			// For now, we provide a structured response that the agent can work with

			const searchResult = {
				query,
				category: category || "general",
				service: service || "unknown",
				results: [] as Array<{
					title: string;
					source: string;
					relevance: number;
					summary: string;
					sections: Array<{
						name: string;
						steps: string[];
					}>;
				}>,
				searchedSources: [
					"runbooks/",
					"docs/operations/",
					"postmortems/",
				],
				guidance: "",
			};

			// Generate contextual guidance based on category
			const categoryGuidance: Record<string, string> = {
				database: "Check connection pool settings, query performance, and replication status",
				network: "Verify DNS resolution, load balancer health, and firewall rules",
				infrastructure: "Review resource utilization, scaling policies, and health checks",
				code: "Look for recent deployments, check error logs, and review stack traces",
				config: "Validate environment variables, feature flags, and configuration files",
				external: "Check third-party service status pages and API health endpoints",
			};

			searchResult.guidance = categoryGuidance[category || "code"] ||
				"Search runbooks for remediation steps related to the identified root cause";

			// Store for later extraction
			runbookStore.push({
				query,
				results: searchResult.results,
			});

			return JSON.stringify({
				status: "searched",
				...searchResult,
				note: "In production, this would return actual runbook content. Use the guidance to inform your fix recommendations.",
				totalSearches: runbookStore.length,
			}, null, 2);
		},
		{
			name: "lookup_runbook",
			description: `Search runbooks and documentation for remediation steps related to an incident.

USE THIS TOOL WHEN:
- You need standard operating procedures for a known issue type
- You want to leverage past solutions for similar incidents
- You need step-by-step remediation guidance

SEARCH TIPS:
- Use specific error messages or symptoms
- Include service name for targeted results
- Specify category to narrow search scope

CATEGORIES:
- database: Connection, query, replication issues
- network: DNS, load balancer, firewall issues
- infrastructure: CPU, memory, disk, scaling issues
- code: Bugs, exceptions, logic errors
- config: Environment variables, feature flags
- external: Third-party service failures

The results will include:
- Relevant runbook titles and sources
- Step-by-step remediation procedures
- Historical success rates when available`,
			schema: z.object({
				query: z.string().describe("Search query - use error messages, symptoms, or keywords"),
				category: z.enum([
					"database",
					"network",
					"infrastructure",
					"code",
					"config",
					"external",
				]).optional().describe("Category to narrow search scope"),
				service: z.string().optional().describe("Specific service name to search runbooks for"),
			}),
		},
	);
}

/**
 * Calculate risk score from factors
 */
function calculateRiskScore(factors: {
	blastRadius: number;
	reversibility: number;
	complexity: number;
	testingCoverage: number;
}): number {
	return Math.round(
		(factors.blastRadius * 0.4) +
		(factors.reversibility * 0.25) +
		(factors.complexity * 0.2) +
		(factors.testingCoverage * 0.15)
	);
}

/**
 * Get risk level from score
 */
function getRiskLevel(score: number): "low" | "medium" | "high" | "critical" {
	if (score <= 25) return "low";
	if (score <= 50) return "medium";
	if (score <= 75) return "high";
	return "critical";
}

/**
 * Get approval requirement based on risk level and change type
 */
function getApprovalRequired(level: string, category: string): string {
	const approvalMatrix: Record<string, Record<string, string>> = {
		low: { code_fix: "self_merge", config_change: "self_deploy", data_change: "peer_review" },
		medium: { code_fix: "peer_review", config_change: "peer_review", data_change: "team_lead" },
		high: { code_fix: "team_lead", config_change: "team_lead", data_change: "cab" },
		critical: { code_fix: "cab", config_change: "cab", data_change: "cab_plus_dba" },
	};
	return approvalMatrix[level]?.[category] || approvalMatrix[level]?.code_fix || "peer_review";
}

/**
 * Create an assess_change_risk tool for evaluating proposed fixes
 */
export function createAssessChangeRiskTool(): StructuredTool {
	return tool(
		async ({
			changeTitle,
			category,
			filesAffected,
			servicesAffected,
			isReversible,
			hasTests,
			blastRadiusScope,
		}) => {
			// Calculate risk factors
			const blastRadiusScores: Record<string, number> = {
				function: 5,
				file: 10,
				service: 25,
				cluster: 45,
				cross_service: 60,
				platform: 80,
			};

			const reversibilityScore = isReversible ? 15 : 60;
			const complexityScore = Math.min(filesAffected * 10, 70);
			const testingScore = hasTests ? 15 : 50;
			const blastRadiusScore = blastRadiusScores[blastRadiusScope] || 30;

			// Add customer-facing modifier
			const customerFacingModifier = servicesAffected.some(
				(s: string) => s.includes("api") || s.includes("frontend") || s.includes("gateway")
			) ? 15 : 0;

			const factors = {
				blastRadius: Math.min(blastRadiusScore + customerFacingModifier, 100),
				reversibility: reversibilityScore,
				complexity: complexityScore,
				testingCoverage: testingScore,
			};

			const overallScore = calculateRiskScore(factors);
			const level = getRiskLevel(overallScore);
			const approvalRequired = getApprovalRequired(level, category);

			// Generate mitigations based on factors
			const mitigations: Array<{ action: string; reducesRiskBy: number }> = [];

			if (!hasTests) {
				mitigations.push({
					action: "Add unit/integration tests before deploying",
					reducesRiskBy: 20,
				});
			}

			if (blastRadiusScope !== "function" && blastRadiusScope !== "file") {
				mitigations.push({
					action: "Deploy with feature flag for gradual rollout",
					reducesRiskBy: 15,
				});
			}

			if (!isReversible) {
				mitigations.push({
					action: "Create backup before applying change",
					reducesRiskBy: 10,
				});
			}

			// Build assessment result
			const assessment = {
				changeTitle,
				overallScore,
				level,
				factors: {
					blastRadius: {
						score: factors.blastRadius,
						reasoning: `Scope: ${blastRadiusScope}, affects ${servicesAffected.length} service(s)`,
					},
					reversibility: {
						score: factors.reversibility,
						reasoning: isReversible ? "Change can be easily reverted" : "Change may be difficult to reverse",
					},
					complexity: {
						score: factors.complexity,
						reasoning: `${filesAffected} file(s) affected`,
					},
					testingCoverage: {
						score: factors.testingCoverage,
						reasoning: hasTests ? "Tests exist for affected code" : "No test coverage for change",
					},
				},
				mitigations,
				approvalRequired,
			};

			// Store for later extraction
			riskAssessmentStore.push(assessment);

			// Generate recommendations based on risk level
			const recommendations: Record<string, string[]> = {
				low: [
					"Standard deployment process",
					"Monitor for 5 minutes post-deploy",
				],
				medium: [
					"Peer review recommended",
					"Monitor for 15 minutes post-deploy",
					"Have rollback ready",
				],
				high: [
					"Team lead approval required",
					"Deploy during low-traffic period",
					"Monitor for 30 minutes post-deploy",
					"Prepare incident response",
				],
				critical: [
					"Change Advisory Board approval required",
					"Schedule maintenance window",
					"Full team standby during deployment",
					"Prepare detailed rollback plan",
				],
			};

			return JSON.stringify({
				status: "assessed",
				assessment,
				recommendations: recommendations[level],
				guidance: level === "critical" || level === "high"
					? "Consider implementing mitigations before proceeding to reduce risk"
					: "Risk level acceptable for standard deployment process",
				totalAssessments: riskAssessmentStore.length,
			}, null, 2);
		},
		{
			name: "assess_change_risk",
			description: `Assess the risk level of a proposed change before implementation.

USE THIS TOOL WHEN:
- You have a fix proposal ready and need to evaluate its risk
- You want to determine what approval level is needed
- You need to identify potential mitigations

RISK FACTORS EVALUATED:
1. Blast Radius (40%) - How many users/services affected
2. Reversibility (25%) - How easy to undo if it fails
3. Complexity (20%) - How many files/services touched
4. Testing Coverage (15%) - Are there tests for this change

RISK LEVELS:
- low (0-25): Standard deployment
- medium (26-50): Peer review recommended
- high (51-75): Team lead approval
- critical (76-100): Change board approval

OUTPUT INCLUDES:
- Overall risk score and level
- Individual factor scores with reasoning
- Recommended mitigations
- Required approval level
- Post-deployment monitoring guidance`,
			schema: z.object({
				changeTitle: z.string().describe("Title of the proposed change"),
				category: z.enum(["code_fix", "config_change", "data_change"]).describe("Type of change"),
				filesAffected: z.number().describe("Number of files being modified"),
				servicesAffected: z.array(z.string()).describe("List of services affected by change"),
				isReversible: z.boolean().describe("Can this change be easily rolled back?"),
				hasTests: z.boolean().describe("Are there tests covering this change?"),
				blastRadiusScope: z.enum([
					"function",
					"file",
					"service",
					"cluster",
					"cross_service",
					"platform",
				]).describe("Scope of potential impact"),
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
		createLookupRunbookTool(),
		createAssessChangeRiskTool(),
	];
}
