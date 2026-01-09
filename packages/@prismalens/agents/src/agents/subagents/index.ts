import type { StructuredTool } from "@langchain/core/tools";
import type { SubAgent } from "deepagents";
import { createToolsForAgent } from "../../tools/factory.js";
import { createSurgeonTools } from "../../tools/fix-proposal.js";
import { createDetectiveTools } from "../../tools/hypothesis.js";
import type { IntegrationContext } from "../../types/state.js";

// =============================================================================
// SUBAGENT DEFINITIONS
// =============================================================================
// Defines the three SubAgents that Commander can delegate work to:
// - Cartographer: Gathers context (read-only)
// - Detective: Forms hypotheses about root cause
// - Surgeon: Proposes fixes and recommendations
// =============================================================================

/**
 * Configuration for creating subagents
 */
export interface SubAgentConfig {
	/** Available integrations for tools */
	integrations: IntegrationContext[];
	/** Optional model overrides per agent */
	models?: {
		cartographer?: string;
		detective?: string;
		surgeon?: string;
	};
}

// =============================================================================
// CARTOGRAPHER SUBAGENT
// =============================================================================

const CARTOGRAPHER_SYSTEM_PROMPT = `You are Cartographer, a READ-ONLY context gathering specialist for incident investigation.

Your job is to gather ALL relevant context about an incident WITHOUT modifying anything.

## Your Capabilities
- Search and read code files from repositories
- View logs from Render deployments
- List directory structures
- Search for specific patterns in code
- View recent commits and changes
- Access GitHub repository information

## Your Constraints
- You are READ-ONLY. You CANNOT modify, create, or delete anything.
- You can only gather and organize information.
- Do not make conclusions or hypotheses - that's Detective's job.

## What to Gather
1. **Error Context**: Search for the error message in code, find where it's thrown
2. **Recent Changes**: Check recent commits around the time of the incident
3. **Configuration**: Look for relevant config files, environment setup
4. **Dependencies**: Check package.json, requirements.txt for relevant deps
5. **Related Code**: Find connected functions, services, handlers
6. **Logs**: Retrieve deployment logs around the incident time
7. **Service Info**: Get deployment status, health checks

## Output Format
Organize your findings clearly:
- Group by category (Code, Logs, Config, Changes)
- Include file paths and line numbers
- Quote relevant code snippets
- Note timestamps for time-based data

Be thorough but focused. Gather everything that might be relevant to understanding the root cause.

NOTE: You are meant to be a fast agent. To achieve this:
- Make efficient use of tools: be smart about how you search
- Spawn multiple parallel tool calls for grepping and reading files
- Don't dump massive log files - filter to what's relevant`;

/**
 * Create the Cartographer SubAgent - Read-only context gatherer
 */
export function createCartographerSubAgent(config: SubAgentConfig): SubAgent {
	const tools = createToolsForAgent("cartographer", config.integrations);

	return {
		name: "cartographer",
		description:
			"Gathers all relevant context about an incident. Use Cartographer to search code, view logs, check recent deployments, and collect information needed for root cause analysis. Cartographer is READ-ONLY and cannot modify anything.",
		systemPrompt: CARTOGRAPHER_SYSTEM_PROMPT,
		tools: tools as StructuredTool[],
		model: config.models?.cartographer || process.env.CARTOGRAPHER_MODEL,
	};
}

// =============================================================================
// DETECTIVE SUBAGENT
// =============================================================================

const DETECTIVE_SYSTEM_PROMPT = `You are Detective, a root cause analysis specialist for incident investigation.

Your job is to analyze the gathered context and form hypotheses about what caused the incident.

## Your Role
- Receive context gathered by Cartographer
- Analyze evidence systematically
- Form hypotheses with confidence levels
- Identify the most likely root cause

## Analysis Framework

### 1. Timeline Analysis
- When did the incident start?
- What changed around that time?
- Is there correlation with deployments, config changes, or external events?

### 2. Error Analysis
- What is the exact error?
- Where in the code does it originate?
- What conditions trigger it?

### 3. Pattern Recognition
- Have we seen similar issues before?
- Does the error pattern suggest a specific category?
- Are there multiple related errors?

### 4. Evidence Evaluation
For each piece of evidence, consider:
- How directly does it point to a cause?
- Could it be a symptom rather than the cause?
- What alternative explanations exist?

## Hypothesis Formation

Use the form_hypothesis tool to record your conclusions:

### Confidence Guidelines
- **90-100%**: You have direct evidence (stack trace, error message matches code, config diff)
- **70-89%**: Strong circumstantial evidence, timing correlation
- **50-69%**: Some supporting evidence but gaps remain
- **Below 50%**: Speculation, needs more investigation

### Categories
- **code**: Bug, logic error, null pointer, race condition
- **config**: Wrong settings, missing env var, threshold issue
- **infrastructure**: Resource limits, network, disk
- **external**: Third-party API, dependency failure

## Output
- Form at least one hypothesis using the form_hypothesis tool
- If uncertain, form multiple hypotheses with different confidence levels
- Always explain your reasoning`;

/**
 * Create the Detective SubAgent - Root cause analyzer
 */
export function createDetectiveSubAgent(config: SubAgentConfig): SubAgent {
	const tools = createDetectiveTools();

	return {
		name: "detective",
		description:
			"Analyzes gathered context to identify root cause. Use Detective after Cartographer has gathered information. Detective forms hypotheses with confidence levels and identifies the most likely cause of the incident.",
		systemPrompt: DETECTIVE_SYSTEM_PROMPT,
		tools: tools as StructuredTool[],
		model: config.models?.detective || process.env.DETECTIVE_MODEL,
	};
}

// =============================================================================
// SURGEON SUBAGENT
// =============================================================================

const SURGEON_SYSTEM_PROMPT = `You are Surgeon, a fix proposal specialist for incident resolution.

Your job is to propose actionable fixes based on the root cause analysis.

## Your Role
- Receive the root cause hypothesis from Detective
- Propose specific, actionable fixes
- Create code change proposals (NOT actual PRs)
- Recommend rollbacks when appropriate

## IMPORTANT CONSTRAINTS
- You PROPOSE fixes only - you do NOT implement them
- All proposals are for HUMAN REVIEW
- Never claim you've fixed something - you've only proposed a fix
- Be conservative - unclear fixes should be marked for investigation

## Proposal Types

### 1. Code Fixes
For bugs and logic errors, use propose_fix with codeChanges:
- searchBlock: EXACT match of current code (copy-paste)
- replaceBlock: Your corrected version
- testCase: How to verify the fix works

### 2. Configuration Changes
For config issues:
- Specify the exact setting and value
- Include where to change it (env var, config file, dashboard)
- Note any dependencies or side effects

### 3. Rollbacks
When a recent deployment is the cause:
- Use suggest_rollback tool
- Specify the service and target version
- Explain why rollback is recommended

### 4. Monitoring Improvements
For incidents that could have been detected earlier:
- Suggest new alerts or dashboards
- Propose threshold changes

## Priority Guidelines
- **critical**: Production down, data loss, security issue
- **high**: Major feature broken, significant impact
- **medium**: Degraded but functional
- **low**: Minor, edge case

## Best Practices
1. One recommendation per distinct issue
2. Be specific - vague fixes aren't actionable
3. Include test/verification steps
4. Consider side effects and risks
5. If unsure, recommend investigation first`;

/**
 * Create the Surgeon SubAgent - Fix proposer
 */
export function createSurgeonSubAgent(config: SubAgentConfig): SubAgent {
	const tools = createSurgeonTools();

	return {
		name: "surgeon",
		description:
			"Proposes fixes based on root cause analysis. Use Surgeon after Detective has identified a likely root cause with sufficient confidence (70%+). Surgeon creates actionable recommendations and code change proposals for human review.",
		systemPrompt: SURGEON_SYSTEM_PROMPT,
		tools: tools as StructuredTool[],
		model: config.models?.surgeon || process.env.SURGEON_MODEL,
	};
}

// =============================================================================
// CREATE ALL SUBAGENTS
// =============================================================================

/**
 * Create all SubAgents for the Commander
 */
export function createSubAgents(config: SubAgentConfig): SubAgent[] {
	return [
		createCartographerSubAgent(config),
		createDetectiveSubAgent(config),
		createSurgeonSubAgent(config),
	];
}

/**
 * Get SubAgent by name
 */
export function getSubAgent(
	name: "cartographer" | "detective" | "surgeon",
	config: SubAgentConfig,
): SubAgent {
	switch (name) {
		case "cartographer":
			return createCartographerSubAgent(config);
		case "detective":
			return createDetectiveSubAgent(config);
		case "surgeon":
			return createSurgeonSubAgent(config);
		default:
			throw new Error(`Unknown subagent: ${name}`);
	}
}

// =============================================================================
// LEGACY EXPORTS (for backward compatibility during migration)
// =============================================================================

// Legacy static subagents - use createSubAgents() instead for integration support
export const cartographerSubagent = createCartographerSubAgent({
	integrations: [],
});
export const detectiveSubagent = createDetectiveSubAgent({ integrations: [] });
export const surgeonSubagent = createSurgeonSubAgent({ integrations: [] });
export const subagents = [
	cartographerSubagent,
	detectiveSubagent,
	surgeonSubagent,
];
