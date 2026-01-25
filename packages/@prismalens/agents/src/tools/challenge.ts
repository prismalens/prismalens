import type { StructuredTool } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Hypothesis } from "../types/state.js";

// =============================================================================
// ADVERSARY CHALLENGE TOOLS
// =============================================================================
// Tools for the Adversary agent to challenge hypotheses using Socratic questioning.
// Based on research showing selective challenge prevents error entrenchment.
// (ACL 2024: https://aclanthology.org/2024.acl-long.331.pdf)
// =============================================================================

/**
 * Challenge record - tracks challenges made during investigation.
 * The graph nodes will extract these after the agent completes.
 */
export interface AdversaryChallenge {
	hypothesisId: string;
	originalConfidence: number;
	originalEvidenceCount: number;
	challenges: {
		type: "assumption" | "blind_spot" | "alternative";
		description: string;
		evidence?: string;
		source?: string;
	}[];
	alternativeHypotheses: string[];
	recommendedConfidenceAdjustment: number;
	refinedHypothesis?: Partial<Hypothesis>;
	skillsUsed: string[];
	timestamp: string;
}

let challengeStore: AdversaryChallenge[] = [];

/**
 * Reset the challenge store (call at start of each investigation)
 */
export function resetChallengeStore(): void {
	challengeStore = [];
}

/**
 * Get all stored challenges (call after agent completes)
 */
export function getStoredChallenges(): AdversaryChallenge[] {
	return [...challengeStore];
}

/**
 * Challenge input schema - what the Adversary provides
 */
const ChallengeInputSchema = z.object({
	hypothesisId: z
		.string()
		.describe("Identifier for the hypothesis being challenged (e.g., 'h1', 'h2')"),
	originalConfidence: z
		.number()
		.min(0)
		.max(100)
		.describe("Original confidence level of the hypothesis"),
	originalEvidenceCount: z
		.number()
		.min(0)
		.describe("Number of evidence items in the original hypothesis"),
	challenges: z
		.array(
			z.object({
				type: z
					.enum(["assumption", "blind_spot", "alternative"])
					.describe(
						"Type of challenge: assumption (unstated premise), blind_spot (unconsidered data), alternative (different explanation)",
					),
				description: z.string().describe("Description of the challenge"),
				evidence: z
					.string()
					.optional()
					.describe("Evidence supporting this challenge from knowledge search"),
				source: z
					.string()
					.optional()
					.describe("Source of evidence (e.g., 'confluence', 'jira', 'pattern-match')"),
			}),
		)
		.min(1)
		.describe("List of challenges to the hypothesis"),
	alternativeHypotheses: z
		.array(z.string())
		.describe("Alternative explanations worth considering"),
	recommendedConfidenceAdjustment: z
		.number()
		.min(-0.5)
		.max(0)
		.describe(
			"Recommended confidence adjustment (-0.5 to 0). Use negative values to reduce confidence.",
		),
	skillsUsed: z
		.array(z.string())
		.describe("Skills/knowledge sources used to generate this challenge"),
});

/**
 * Create the challenge_hypothesis tool for the Adversary agent.
 * This tool allows the Adversary to formally record challenges to hypotheses.
 */
export function createChallengeHypothesisTool(): StructuredTool {
	return tool(
		async (input) => {
			try {
				const validated = ChallengeInputSchema.parse(input);

				const challenge: AdversaryChallenge = {
					...validated,
					timestamp: new Date().toISOString(),
				};

				challengeStore.push(challenge);

				// Calculate severity of challenges
				const assumptionCount = validated.challenges.filter(
					(c) => c.type === "assumption",
				).length;
				const blindSpotCount = validated.challenges.filter(
					(c) => c.type === "blind_spot",
				).length;
				const alternativeCount = validated.challenges.filter(
					(c) => c.type === "alternative",
				).length;

				const severity =
					assumptionCount >= 2 || blindSpotCount >= 2
						? "HIGH"
						: assumptionCount >= 1 || blindSpotCount >= 1
							? "MEDIUM"
							: "LOW";

				const adjustedConfidence = Math.max(
					0,
					validated.originalConfidence +
						validated.recommendedConfidenceAdjustment * 100,
				);

				return JSON.stringify(
					{
						status: "challenged",
						hypothesisId: validated.hypothesisId,
						challengeSeverity: severity,
						summary: {
							assumptionChallenges: assumptionCount,
							blindSpotChallenges: blindSpotCount,
							alternativesChallenges: alternativeCount,
							totalChallenges: validated.challenges.length,
							alternativeHypothesesCount: validated.alternativeHypotheses.length,
						},
						confidenceImpact: {
							original: validated.originalConfidence,
							adjustment: validated.recommendedConfidenceAdjustment,
							recommended: adjustedConfidence,
						},
						guidance:
							severity === "HIGH"
								? "Significant challenges identified. Hypothesis may need major revision or rejection."
								: severity === "MEDIUM"
									? "Notable challenges found. Consider investigating further before proceeding."
									: "Minor challenges. Hypothesis appears reasonably solid.",
						skillsUsed: validated.skillsUsed,
						totalChallengesRecorded: challengeStore.length,
					},
					null,
					2,
				);
			} catch (error) {
				if (error instanceof z.ZodError) {
					return JSON.stringify(
						{
							status: "error",
							error: "Invalid challenge format",
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
			name: "challenge_hypothesis",
			description: `Challenge a hypothesis using Socratic questioning and evidence from knowledge sources.

WHEN TO USE:
- After Detective has formed a hypothesis with high confidence (>=80%)
- After Detective has formed a hypothesis with thin evidence (<=2 items)
- To strengthen investigation by identifying weaknesses

CHALLENGE TYPES:
- assumption: Question unstated premises in the hypothesis
- blind_spot: Point out data or perspectives not considered
- alternative: Propose other explanations for the same symptoms

CONFIDENCE ADJUSTMENT:
- Use -0.1 to -0.2 for minor challenges
- Use -0.2 to -0.3 for significant challenges
- Use -0.3 to -0.5 for critical flaws

Your goal is NOT to be contrarian, but to strengthen the investigation.`,
			schema: ChallengeInputSchema,
		},
	);
}

/**
 * Refinement input schema
 */
const RefinementInputSchema = z.object({
	hypothesisId: z.string().describe("ID of the hypothesis being refined"),
	originalClaim: z.string().describe("Original hypothesis claim"),
	refinedClaim: z.string().describe("Refined hypothesis claim"),
	refinedConfidence: z
		.number()
		.min(0)
		.max(100)
		.describe("New confidence level after refinement"),
	additionalEvidence: z
		.array(z.string())
		.describe("Additional evidence discovered during challenge"),
	refinementReason: z.string().describe("Explanation of why the refinement improves the hypothesis"),
});

/**
 * Create the refine_hypothesis tool for the Adversary agent.
 * This tool allows the Adversary to propose improvements to hypotheses.
 */
export function createRefineHypothesisTool(): StructuredTool {
	return tool(
		async (input) => {
			try {
				const validated = RefinementInputSchema.parse(input);

				// Store refinement in the last challenge for this hypothesis
				const lastChallenge = challengeStore
					.filter((c) => c.hypothesisId === validated.hypothesisId)
					.pop();

				if (lastChallenge) {
					lastChallenge.refinedHypothesis = {
						claim: validated.refinedClaim,
						confidence: validated.refinedConfidence,
						evidence: validated.additionalEvidence,
					};
				}

				return JSON.stringify(
					{
						status: "refined",
						hypothesisId: validated.hypothesisId,
						refinement: {
							originalClaim: validated.originalClaim,
							refinedClaim: validated.refinedClaim,
							confidenceChange:
								validated.refinedConfidence -
								(lastChallenge?.originalConfidence || 0),
							additionalEvidenceCount: validated.additionalEvidence.length,
						},
						reason: validated.refinementReason,
						recommendation:
							"Pass refined hypothesis back to Detective for validation.",
					},
					null,
					2,
				);
			} catch (error) {
				if (error instanceof z.ZodError) {
					return JSON.stringify(
						{
							status: "error",
							error: "Invalid refinement format",
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
			name: "refine_hypothesis",
			description: `Propose a refined version of a hypothesis based on challenge findings.

WHEN TO USE:
- After challenging a hypothesis and identifying specific improvements
- When you can make the hypothesis more accurate or precise
- When additional evidence should be incorporated

REFINEMENT GUIDELINES:
- Make claims more specific and testable
- Incorporate evidence that was overlooked
- Adjust confidence based on total evidence
- Explain why the refinement is an improvement`,
			schema: RefinementInputSchema,
		},
	);
}

// =============================================================================
// PATTERN MATCH TOOL (FALLBACK)
// =============================================================================
// Built-in pattern matching for common incident types.
// Always available, even without RAG or MCP integrations.
// =============================================================================

/**
 * Known incident patterns for matching
 */
const KNOWN_PATTERNS = {
	database: [
		{
			pattern: /connection\s*(pool|timeout|refused)/i,
			insight:
				"Database connection issues often indicate: 1) Connection pool exhaustion, 2) Database server overload, 3) Network issues between app and DB",
			alternatives: [
				"Application leak not closing connections",
				"Sudden traffic spike exhausting pool",
				"Database server resource limits",
			],
		},
		{
			pattern: /deadlock|lock\s*wait\s*timeout/i,
			insight:
				"Deadlocks typically occur from: 1) Concurrent transactions on same rows, 2) Inconsistent lock ordering, 3) Long-running transactions",
			alternatives: [
				"Recent code change affecting transaction ordering",
				"New feature accessing same tables differently",
				"Background job conflicting with user operations",
			],
		},
		{
			pattern: /migration|schema|alter\s*table/i,
			insight:
				"Database schema changes are high-risk: 1) May lock tables, 2) Can cause connection timeouts, 3) May break application queries",
			alternatives: [
				"Migration timing causing peak-hour issues",
				"Schema change breaking existing queries",
				"Index creation causing table locks",
			],
		},
	],
	kubernetes: [
		{
			pattern: /oom|out\s*of\s*memory|killed/i,
			insight:
				"OOM kills indicate: 1) Memory limits too low, 2) Memory leak, 3) Sudden memory spike from load",
			alternatives: [
				"Memory limit needs increase",
				"Application memory leak",
				"Large request causing spike",
			],
		},
		{
			pattern: /crashloopbackoff|restart/i,
			insight:
				"CrashLoopBackOff usually means: 1) Application crash on startup, 2) Failing health checks, 3) Missing dependencies",
			alternatives: [
				"Missing environment variable",
				"Database not reachable at startup",
				"Misconfigured health check endpoint",
			],
		},
		{
			pattern: /evict|preempt|node\s*pressure/i,
			insight:
				"Pod eviction indicates: 1) Node resource pressure, 2) Cluster scaling issues, 3) Resource requests too high",
			alternatives: [
				"Node disk pressure",
				"Node memory pressure",
				"Resource quota exceeded",
			],
		},
	],
	network: [
		{
			pattern: /timeout|ETIMEDOUT|ECONNREFUSED/i,
			insight:
				"Network timeouts suggest: 1) Service unavailability, 2) Network connectivity issues, 3) Slow response times",
			alternatives: [
				"Target service is down",
				"Firewall blocking connection",
				"DNS resolution failure",
			],
		},
		{
			pattern: /ssl|tls|certificate/i,
			insight:
				"SSL/TLS errors often mean: 1) Expired certificate, 2) Certificate mismatch, 3) TLS version incompatibility",
			alternatives: [
				"Certificate needs renewal",
				"Wrong certificate for domain",
				"Client TLS version too old",
			],
		},
	],
	memory: [
		{
			pattern: /heap|garbage\s*collection|gc\s*pause/i,
			insight:
				"Heap/GC issues indicate: 1) Memory leak, 2) Heap size too small, 3) Object creation rate too high",
			alternatives: [
				"Memory leak in recent code",
				"Need to increase heap size",
				"Inefficient object allocation",
			],
		},
	],
};

const PatternMatchInputSchema = z.object({
	text: z
		.string()
		.describe(
			"Text to match against known patterns (error message, hypothesis claim, logs)",
		),
	categories: z
		.array(z.enum(["database", "kubernetes", "network", "memory"]))
		.optional()
		.describe("Specific categories to search (default: all)"),
});

/**
 * Create the pattern_match tool for the Adversary agent.
 * Built-in pattern matching for common incident types.
 */
export function createPatternMatchTool(): StructuredTool {
	return tool(
		async (input) => {
			try {
				const validated = PatternMatchInputSchema.parse(input);
				const text = validated.text;
				const categories = validated.categories || [
					"database",
					"kubernetes",
					"network",
					"memory",
				];

				const matches: {
					category: string;
					pattern: string;
					insight: string;
					alternatives: string[];
				}[] = [];

				for (const category of categories) {
					const patterns = KNOWN_PATTERNS[category] || [];
					for (const { pattern, insight, alternatives } of patterns) {
						if (pattern.test(text)) {
							matches.push({
								category,
								pattern: pattern.toString(),
								insight,
								alternatives,
							});
						}
					}
				}

				if (matches.length === 0) {
					return JSON.stringify(
						{
							status: "no_match",
							message:
								"No known patterns matched. Consider searching knowledge bases for more context.",
							searchedCategories: categories,
						},
						null,
						2,
					);
				}

				return JSON.stringify(
					{
						status: "matched",
						matchCount: matches.length,
						matches,
						recommendation:
							matches.length > 1
								? "Multiple patterns matched. Consider the most specific one based on context."
								: "Pattern matched. Use insights to challenge or validate the hypothesis.",
					},
					null,
					2,
				);
			} catch (error) {
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
			name: "pattern_match",
			description: `Match text against known incident patterns to find relevant insights.

WHEN TO USE:
- To check if error messages match known patterns
- To get alternative hypotheses based on known issues
- When no RAG or MCP knowledge sources are available

AVAILABLE CATEGORIES:
- database: Connection pools, deadlocks, migrations
- kubernetes: OOM, CrashLoopBackOff, evictions
- network: Timeouts, SSL/TLS, connectivity
- memory: Heap, GC, memory leaks

This tool provides quick insights from built-in patterns without external dependencies.`,
			schema: PatternMatchInputSchema,
		},
	);
}

/**
 * Create all challenge-related tools for Adversary agent
 */
export function createAdversaryTools(): StructuredTool[] {
	return [
		createChallengeHypothesisTool(),
		createRefineHypothesisTool(),
		createPatternMatchTool(),
	];
}
