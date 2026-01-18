import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StructuredTool } from "@langchain/core/tools";
import {
	createSkillsMiddleware,
	FilesystemBackend,
	type SkillsMiddlewareOptions,
	type SubAgent,
} from "deepagents";
import type { MCPClientManager } from "../../mcp/client.js";
import {
	CARTOGRAPHER_SYSTEM_REMINDER,
	DETECTIVE_SYSTEM_REMINDER,
	SURGEON_SYSTEM_REMINDER,
} from "../../middleware/system-reminders.js";
import {
	createDefaultToolDisclosureMiddleware,
	type ToolDisclosureMiddleware,
} from "../../middleware/tool-disclosure.js";
import { createToolsForAgent } from "../../tools/factory.js";
import { createSurgeonTools } from "../../tools/fix-proposal.js";
import { createDetectiveTools } from "../../tools/hypothesis.js";
import { getMCPToolsForAgent } from "../../tools/mcp/index.js";
import type { IntegrationContext } from "../../types/state.js";

// Type for middleware - generic to work with both skills and tool disclosure middleware
type AgentMiddleware =
	| ReturnType<typeof createSkillsMiddleware>
	| ToolDisclosureMiddleware;

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
	/** Whether to enable skills middleware (default: true) */
	enableSkills?: boolean;
	/**
	 * Whether to use progressive tool disclosure instead of loading all tools at once.
	 * When enabled, agents use meta-tools (search_tools, call_tool) to discover and load tools on-demand.
	 * This significantly reduces token usage when dealing with large tool sets.
	 * (default: false for backward compatibility)
	 */
	useProgressiveDisclosure?: boolean;
	/**
	 * Bundles to pre-enable when using progressive disclosure.
	 * Only used when useProgressiveDisclosure is true.
	 */
	preEnabledBundles?: string[];
	/**
	 * MCP Client Manager for code analysis tools.
	 * When provided, MCP tools (code-pathfinder, code-index, ripgrep) are added to subagents.
	 */
	mcpClientManager?: MCPClientManager;
}

// =============================================================================
// SKILLS HELPER FUNCTIONS
// =============================================================================

type SubAgentName = "cartographer" | "detective" | "surgeon";

/**
 * Get the built-in skills directory for a subagent.
 * Skills are bundled with the package in src/skills/{subagentName}/
 */
function getBuiltinSkillsDir(subagentName: SubAgentName): string {
	// Navigate from agents/subagents/ to skills/{subagentName}/
	return path.join(__dirname, "..", "..", "skills", subagentName);
}

/**
 * Get environment variable name for custom skills directory.
 */
function getSkillsEnvVar(subagentName: SubAgentName): string {
	return `${subagentName.toUpperCase()}_SKILLS_DIR`;
}

/**
 * Get skills middleware options for a subagent.
 * Supports built-in skills and optional custom skills via env vars.
 */
function getSkillsMiddlewareOptions(
	subagentName: SubAgentName,
): SkillsMiddlewareOptions {
	const sources: string[] = [];

	// Add built-in skills directory (use POSIX-style paths)
	const builtinDir = getBuiltinSkillsDir(subagentName);
	// Convert to POSIX path format for skills middleware
	sources.push(builtinDir.split(path.sep).join("/"));

	// Add custom skills directory from env var if set
	const customDir = process.env[getSkillsEnvVar(subagentName)];
	if (customDir) {
		sources.push(customDir.split(path.sep).join("/"));
	}

	// Add additional skills directory if set (shared across all agents)
	const additionalDir = process.env.ADDITIONAL_SKILLS_DIR;
	if (additionalDir) {
		const combinedPath = path.join(additionalDir, subagentName);
		sources.push(combinedPath.split(path.sep).join("/"));
	}

	// Use FilesystemBackend for reading skill files from disk
	const backend = new FilesystemBackend();

	return { backend, sources };
}

// =============================================================================
// PROGRESSIVE DISCLOSURE INSTRUCTIONS
// =============================================================================
// Added to system prompts when useProgressiveDisclosure is enabled.
// =============================================================================

const PROGRESSIVE_DISCLOSURE_INSTRUCTIONS = `

## Tool Discovery (Progressive Disclosure)
You have access to a tool discovery system. Instead of having all tools loaded at once, you can:

1. **search_tools**: Search for tools by describing what you need
   - Example: \`search_tools({ query: "search code files" })\`
   - This will find and enable relevant tool bundles

2. **call_tool**: Execute a tool from an enabled bundle
   - Example: \`call_tool({ toolName: "github_get_file", arguments: { owner: "...", repo: "...", path: "..." } })\`
   - Only works for tools from bundles you've enabled with search_tools

3. **list_enabled_tools**: See what tools you currently have access to

**Workflow:**
1. First, use search_tools to find the tools you need
2. Then, use call_tool to execute those tools
3. If a tool isn't found, use search_tools again with a different query

This system helps manage large tool sets efficiently. Always search for tools before trying to use them.
`;

// =============================================================================
// CARTOGRAPHER SUBAGENT
// =============================================================================

const CARTOGRAPHER_SYSTEM_PROMPT = `You are Cartographer, a READ-ONLY context gathering specialist for incident investigation.

Your job is to gather ALL relevant context about an incident WITHOUT modifying anything.

## Your Skills
You have access to specialized skills for gathering context. Each skill provides detailed instructions
for specific tasks. To use a skill, read its SKILL.md file for detailed process and output format.

Available skills:
- **log-analysis**: Fetch and analyze logs from deployment platforms
- **code-search**: Search codebase for error origins and patterns
- **deployment-check**: Check deployment status and history
- **recent-commits**: Analyze recent git commits for changes
- **dependency-trace**: (MCP) Trace file dependencies to find related code
- **code-structure**: (MCP) Analyze code structure using AST-based tools

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
Return a STRUCTURED SUMMARY (not raw data) with:
- **findings**: List of what you discovered, organized by category
- **confidence**: 0-100 based on data quality and completeness
- **suggestedNextSteps**: What Detective should investigate

Be thorough but focused. Gather everything that might be relevant to understanding the root cause.

NOTE: You are meant to be a fast agent. To achieve this:
- Make efficient use of tools: be smart about how you search
- Spawn multiple parallel tool calls for grepping and reading files
- Don't dump massive log files - filter to what's relevant`;

/**
 * Create the Cartographer SubAgent - Read-only context gatherer
 */
export function createCartographerSubAgent(config: SubAgentConfig): SubAgent {
	const enableSkills = config.enableSkills !== false; // Default to true
	const useProgressiveDisclosure = config.useProgressiveDisclosure === true;

	// Build middleware array
	const middlewareList: AgentMiddleware[] = [];

	// Add skills middleware if enabled
	if (enableSkills) {
		middlewareList.push(
			createSkillsMiddleware(getSkillsMiddlewareOptions("cartographer")),
		);
	}

	// Add tool disclosure middleware if progressive disclosure is enabled
	if (useProgressiveDisclosure) {
		middlewareList.push(
			createDefaultToolDisclosureMiddleware({
				integrations: config.integrations,
				agentName: "cartographer",
				readOnly: true,
				preEnabledBundles: config.preEnabledBundles,
			}),
		);
	}

	// Create tools - empty array if using progressive disclosure (tools come from middleware)
	let tools: StructuredTool[] = useProgressiveDisclosure
		? []
		: createToolsForAgent("cartographer", config.integrations);

	// Add MCP tools if client manager is available
	if (config.mcpClientManager) {
		const mcpTools = getMCPToolsForAgent(
			config.mcpClientManager,
			"cartographer",
		);
		tools = [...tools, ...mcpTools];
	}

	// Build system prompt - add progressive disclosure instructions and system reminder
	let systemPrompt = CARTOGRAPHER_SYSTEM_PROMPT;
	if (useProgressiveDisclosure) {
		systemPrompt += PROGRESSIVE_DISCLOSURE_INSTRUCTIONS;
	}
	// Always add system reminder at the end
	systemPrompt += CARTOGRAPHER_SYSTEM_REMINDER;

	return {
		name: "cartographer",
		description:
			"Gathers all relevant context about an incident. Has skills for: log-analysis, code-search, deployment-check, recent-commits, dependency-trace (MCP), code-structure (MCP). Use Cartographer to search code, view logs, check recent deployments, trace dependencies, and collect information needed for root cause analysis. Cartographer is READ-ONLY and cannot modify anything.",
		systemPrompt,
		tools: tools as StructuredTool[],
		model: config.models?.cartographer || process.env.CARTOGRAPHER_MODEL,
		// Cast middleware to any since our tool disclosure middleware is compatible with
		// deepagents middleware pattern but TypeScript can't infer this from the branded type
		middleware:
			middlewareList.length > 0
				? (middlewareList as unknown as SubAgent["middleware"])
				: undefined,
	};
}

// =============================================================================
// DETECTIVE SUBAGENT
// =============================================================================

const DETECTIVE_SYSTEM_PROMPT = `You are Detective, a root cause analysis specialist for incident investigation.

Your job is to analyze the gathered context and form hypotheses about what caused the incident.

## Your Skills
You have access to specialized skills for root cause analysis. Each skill provides detailed instructions
for specific analysis methods. To use a skill, read its SKILL.md file for detailed process and output format.

Available skills:
- **hypothesis-formation**: Form and validate root cause hypotheses with confidence levels
- **timeline-analysis**: Build chronological event timeline to identify causation chains
- **pattern-correlation**: Cross-reference patterns across multiple data sources
- **error-origin-trace**: (MCP) Trace errors back to their actual source across code
- **cross-service-analysis**: (MCP) Analyze errors across multiple services to find cascade origins

## Your Role
- Receive context gathered by Cartographer
- Analyze evidence systematically using your skills
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
	let tools: StructuredTool[] = createDetectiveTools() as StructuredTool[];
	const enableSkills = config.enableSkills !== false; // Default to true

	// Create skills middleware if enabled
	const middleware = enableSkills
		? [createSkillsMiddleware(getSkillsMiddlewareOptions("detective"))]
		: undefined;

	// Add MCP tools if client manager is available
	if (config.mcpClientManager) {
		const mcpTools = getMCPToolsForAgent(config.mcpClientManager, "detective");
		tools = [...tools, ...mcpTools];
	}

	// Build system prompt with system reminder
	const systemPrompt = DETECTIVE_SYSTEM_PROMPT + DETECTIVE_SYSTEM_REMINDER;

	return {
		name: "detective",
		description:
			"Analyzes gathered context to identify root cause. Has skills for: hypothesis-formation, timeline-analysis, pattern-correlation, error-origin-trace (MCP), cross-service-analysis (MCP). Use Detective after Cartographer has gathered information. Detective forms hypotheses with confidence levels, traces errors to their origin, and identifies cascade sources in distributed systems.",
		systemPrompt,
		tools,
		model: config.models?.detective || process.env.DETECTIVE_MODEL,
		middleware,
	};
}

// =============================================================================
// SURGEON SUBAGENT
// =============================================================================

const SURGEON_SYSTEM_PROMPT = `You are Surgeon, a fix proposal specialist for incident resolution.

Your job is to propose actionable fixes based on the root cause analysis.

## Your Skills
You have access to specialized skills for proposing fixes. Each skill provides detailed instructions
for specific fix types. To use a skill, read its SKILL.md file for detailed process and output format.

Available skills:
- **code-fix**: Propose specific code changes with search/replace blocks
- **rollback-proposal**: Recommend deployment rollbacks when appropriate
- **config-change**: Recommend configuration changes (env vars, feature flags, thresholds)

## Your Role
- Receive the root cause hypothesis from Detective
- Propose specific, actionable fixes using your skills
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
	let tools: StructuredTool[] = createSurgeonTools() as StructuredTool[];
	const enableSkills = config.enableSkills !== false; // Default to true

	// Create skills middleware if enabled
	const middleware = enableSkills
		? [createSkillsMiddleware(getSkillsMiddlewareOptions("surgeon"))]
		: undefined;

	// Add MCP tools if client manager is available (limited set for code understanding)
	if (config.mcpClientManager) {
		const mcpTools = getMCPToolsForAgent(config.mcpClientManager, "surgeon");
		tools = [...tools, ...mcpTools];
	}

	// Build system prompt with system reminder
	const systemPrompt = SURGEON_SYSTEM_PROMPT + SURGEON_SYSTEM_REMINDER;

	return {
		name: "surgeon",
		description:
			"Proposes fixes based on root cause analysis. Has skills for: code-fix, rollback-proposal, config-change. Use Surgeon after Detective has identified a likely root cause with sufficient confidence (70%+). Surgeon creates actionable recommendations and code change proposals for human review.",
		systemPrompt,
		tools,
		model: config.models?.surgeon || process.env.SURGEON_MODEL,
		middleware,
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
