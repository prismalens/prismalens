/**
 * Change Tracker Agent Node
 *
 * Tracks recent changes (deployments, commits, PRs) that might be related
 * to the incident. Based on the BigPanda pattern: 60-90% of incidents
 * are caused by changes.
 *
 * This is a LangGraph node that runs a ReAct agent internally.
 */

import type { RunnableConfig } from "@langchain/core/runnables";
import { createAgent } from "langchain";
import { Logger } from "@prismalens/logger";
import { createAgentLLM } from "../../llm/factory.js";
import { createToolsForAgent } from "../../tools/factory.js";
import { createHandoffCompletionUpdate } from "../../graph/nodes/handoff-processor.js";
import { buildTraceConfig, mergeTraceConfig } from "../../utils/tracing.js";
import type {
	DeploymentChange,
	Finding,
	IntegrationResolver,
	InvestigationState,
	SupervisorPhase,
} from "../../types/index.js";
import { addFindingIds, validateChangeFindings } from "../../utils/validation.js";

const logger = new Logger({ context: "ChangeTracker" });

// =============================================================================
// SYSTEM PROMPT
// =============================================================================

const CHANGE_TRACKER_SYSTEM_PROMPT = `You are a Change Tracker agent specializing in correlating incidents with recent changes.

## Critical Insight
**60-90% of incidents are caused by changes.** Your job is to find the change that likely caused this incident.

## What You Should Find
1. **Recent Deployments** - Within the last 24 hours, especially the last 4 hours
2. **Recent Commits** - Code changes that might have introduced bugs
3. **Configuration Changes** - Environment variable updates, feature flags
4. **Infrastructure Changes** - Scaling events, node changes

## Risk Scoring
Rate each change by risk score (0-100):
- **High (70-100)**: Change within 1 hour of incident, touches affected service
- **Medium (40-69)**: Change within 4 hours, related service or infrastructure
- **Low (0-39)**: Change over 4 hours ago, loosely related

## Output Format
For each relevant change, report:
- Type: deployment, commit, config_change, infrastructure
- Timestamp: When the change occurred
- Risk Score: Based on timing and relevance
- Risk Factors: Why this change is suspicious
- Details: What changed, who made it, link if available

## Constraints
- You are READ-ONLY - you cannot revert changes
- Focus on changes before the incident, not after
- Prioritize by risk score
- Include links to PRs/deployments when available
`;

// =============================================================================
// CHANGE TRACKER NODE
// =============================================================================

/**
 * Change Tracker node - tracks recent changes correlated with incident.
 *
 * This node runs a ReAct agent to find changes and produces
 * findings that are added to the investigation state.
 */
export async function changeTrackerNode(
	state: InvestigationState,
	config?: RunnableConfig,
): Promise<Partial<InvestigationState>> {
	// Build trace config for this node
	const traceConfig = buildTraceConfig(state);

	logger.info("Change Tracker starting", {
		investigationId: state.investigationId,
		runName: traceConfig.runName,
	});

	try {
		// Get code files for correlation (from code-searcher findings)
		const codeFiles = buildChangeContext(state).relevantFiles;
		const windowLevel = state.validationWindowLevel || 1;

		// First, try to use pre-gathered change context
		const preGatheredFindings = extractFromPreGathered(state);
		if (preGatheredFindings.length > 0) {
			// Add IDs for correlation tracking
			const findingsWithIds = addFindingIds(preGatheredFindings);

			// Validate findings
			const validationResult = validateChangeFindings(
				findingsWithIds,
				{
					triggeredAt: state.incident?.triggeredAt,
					serviceName: state.incident?.serviceName,
					codeFiles,
				},
				windowLevel,
			);

			logger.info("Using pre-gathered change context", {
				total: preGatheredFindings.length,
				valid: validationResult.valid.length,
				filtered: validationResult.filtered.length,
				windowLevel,
			});

			// Create handoff completion update if this was a targeted gather
			const handoffCompletion = createHandoffCompletionUpdate(
				state,
				`Found ${validationResult.valid.length} change findings (from pre-gathered context)`,
				validationResult.valid.length,
			);

			return {
				findings: validationResult.valid,
				currentAgent: undefined,
				...handoffCompletion,
			};
		}

		// If no pre-gathered data, run the agent
		const llm = createAgentLLM("gatherer", { temperature: 0.1 });

		// Resolve integrations on-demand via configurable resolver
		const resolver = config?.configurable?.integrationResolver as IntegrationResolver | undefined;
		const integrations = resolver ? await resolver.resolve() : [];

		const tools = createToolsForAgent("gatherer", integrations, {
			clonePaths: state.clonePaths,
		});

		// Create the agent with todo list middleware
		const agent = createAgent({
			model: llm,
			tools,
			systemPrompt: CHANGE_TRACKER_SYSTEM_PROMPT,
		});

		// Build the input message
		const incidentTime = state.incident?.triggeredAt || new Date().toISOString();
		const serviceName = state.incident?.serviceName || state.primaryAlert?.serviceName || "unknown";
		const repository = state.primaryAlert?.repository || "unknown";

		// Get relevant files from code-searcher findings
		const changeContext = buildChangeContext(state);
		const relevantFilesSection = changeContext.relevantFiles.length > 0
			? `## Files Identified by Code Analysis\n${changeContext.relevantFiles.map((f) => `- ${f}`).join("\n")}\n\nPrioritize commits that touch these files.`
			: "";

		const inputMessage = `
Track changes that might have caused this incident:

## Incident Context
- Incident Time: ${incidentTime}
- Service: ${serviceName}
- Repository: ${repository}
- Severity: ${state.incident?.severity || "unknown"}
- Title: ${state.incident?.title || state.primaryAlert?.title || "Unknown"}

${relevantFilesSection}

## What to Find
1. Deployments in the last 24 hours (especially last 4 hours before incident)
2. Recent commits to the repository${changeContext.relevantFiles.length > 0 ? " (especially those touching the files above)" : ""}
3. Configuration changes
4. Infrastructure changes

Rate each change by risk score and explain why it might be relevant.
${changeContext.relevantFiles.length > 0 ? "Boost risk scores for changes that touch the files identified by code analysis." : ""}
`;

		// Invoke the agent with trace config
		const result = await agent.invoke(
			{ messages: [{ role: "user", content: inputMessage }] },
			mergeTraceConfig(config, traceConfig),
		);

		// Extract findings from agent response
		const rawFindings = extractFindingsFromAgentResult(result.messages, "change-tracker");

		// Add IDs for correlation tracking
		const findingsWithIds = addFindingIds(rawFindings);

		// Validate findings
		const validationResult = validateChangeFindings(
			findingsWithIds,
			{
				triggeredAt: state.incident?.triggeredAt,
				serviceName: state.incident?.serviceName,
				codeFiles,
			},
			windowLevel,
		);

		logger.info("Change Tracker complete", {
			total: rawFindings.length,
			valid: validationResult.valid.length,
			filtered: validationResult.filtered.length,
			windowLevel,
		});

		// Create handoff completion update if this was a targeted gather
		const handoffCompletion = createHandoffCompletionUpdate(
			state,
			`Found ${validationResult.valid.length} change findings`,
			validationResult.valid.length,
		);

		return {
			findings: validationResult.valid,
			currentAgent: undefined,
			...handoffCompletion,
		};
	} catch (error) {
		logger.error("Change Tracker failed", { error });
		return {
			agentErrors: [
				{
					agent: "change-tracker",
					error: error instanceof Error ? error.message : String(error),
					timestamp: new Date().toISOString(),
					recoverable: true,
				},
			],
			handoffRequest: undefined,
			// Set phase to analyzing to avoid getting stuck in targeted_gather
			phase: "analyzing" as SupervisorPhase,
		};
	}
}

/**
 * Extract findings from pre-gathered context.
 * Uses the data already fetched by the preGather node.
 */
function extractFromPreGathered(state: InvestigationState): Finding[] {
	const findings: Finding[] = [];
	const preGathered = state.preGatheredContext;

	if (!preGathered) {
		return findings;
	}

	// Convert deployments to findings
	for (const deployment of preGathered.recentChanges.deployments) {
		findings.push({
			source: "change-tracker",
			type: "deployment",
			summary: buildDeploymentSummary(deployment),
			details: deployment,
			relevance: deployment.riskScore,
			timestamp: deployment.timestamp,
		});
	}

	// Convert commits to findings
	for (const commit of preGathered.recentChanges.commits) {
		findings.push({
			source: "change-tracker",
			type: "commit",
			summary: `Commit ${commit.sha.slice(0, 7)}: ${commit.message.slice(0, 100)}`,
			details: commit,
			relevance: calculateCommitRelevance(commit, state),
			timestamp: commit.timestamp,
		});
	}

	// Convert config changes to findings
	for (const config of preGathered.recentChanges.configChanges) {
		findings.push({
			source: "change-tracker",
			type: "config",
			summary: `Config change: ${config.key}`,
			details: config,
			relevance: 60, // Config changes are often relevant
			timestamp: config.timestamp,
		});
	}

	return findings;
}

/**
 * Build a human-readable summary for a deployment
 */
function buildDeploymentSummary(deployment: DeploymentChange): string {
	const parts = [
		`Deployment ${deployment.id}`,
	];

	if (deployment.service) {
		parts.push(`to ${deployment.service}`);
	}

	if (deployment.version) {
		parts.push(`(${deployment.version})`);
	}

	parts.push(`- Risk: ${deployment.riskScore}%`);

	if (deployment.riskFactors.length > 0) {
		parts.push(`[${deployment.riskFactors.join(", ")}]`);
	}

	return parts.join(" ");
}

/**
 * Calculate relevance score for a commit
 */
function calculateCommitRelevance(
	commit: { timestamp: string; message: string },
	state: InvestigationState,
): number {
	let relevance = 30; // Base score

	// Time-based scoring
	const incidentTime = new Date(state.incident?.triggeredAt || new Date());
	const commitTime = new Date(commit.timestamp);
	const deltaHours = (incidentTime.getTime() - commitTime.getTime()) / (1000 * 60 * 60);

	if (deltaHours > 0 && deltaHours <= 1) {
		relevance += 40; // Within 1 hour before incident
	} else if (deltaHours > 1 && deltaHours <= 4) {
		relevance += 25;
	} else if (deltaHours > 4 && deltaHours <= 24) {
		relevance += 10;
	}

	// Keyword-based scoring
	const riskyKeywords = ["fix", "bug", "error", "hotfix", "urgent", "revert"];
	const message = commit.message.toLowerCase();
	for (const keyword of riskyKeywords) {
		if (message.includes(keyword)) {
			relevance += 10;
			break;
		}
	}

	return Math.min(100, relevance);
}

/**
 * Context for change tracking built from code-searcher findings.
 */
interface ChangeContext {
	relevantFiles: string[];
}

/**
 * Build change context from code-searcher findings.
 * Identifies files to prioritize when looking at commits.
 */
function buildChangeContext(state: InvestigationState): ChangeContext {
	const relevantFiles: string[] = [];

	// Get file paths from code-searcher findings
	const codeFindings = state.findings.filter((f) => f.source === "code-searcher");

	for (const finding of codeFindings) {
		const details = finding.details as { filePath?: string; lineNumber?: number };
		if (details?.filePath) {
			relevantFiles.push(details.filePath);
		}
	}

	// Deduplicate
	return {
		relevantFiles: [...new Set(relevantFiles)],
	};
}

/**
 * Extract structured findings from agent result.
 */
function extractFindingsFromAgentResult(
	messages: Array<{ content: string | unknown }>,
	source: Finding["source"],
): Finding[] {
	const findings: Finding[] = [];

	// Get the last message from the agent
	const lastMessage = messages[messages.length - 1];
	if (!lastMessage?.content) {
		return findings;
	}

	const content = typeof lastMessage.content === "string"
		? lastMessage.content
		: JSON.stringify(lastMessage.content);

	// Try to parse structured findings from the response
	try {
		const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[1]);
			if (Array.isArray(parsed)) {
				for (const item of parsed) {
					findings.push({
						source,
						type: item.type || "deployment",
						summary: item.summary || item.description || "Change finding",
						details: item,
						relevance: item.riskScore || item.relevance || 50,
						timestamp: item.timestamp,
					});
				}
				return findings;
			}
		}
	} catch {
		// JSON parsing failed, fall back to text extraction
	}

	// Fall back to creating a single finding
	findings.push({
		source,
		type: "deployment",
		summary: content.slice(0, 500),
		details: { rawResponse: content },
		relevance: 50,
		timestamp: new Date().toISOString(),
	});

	return findings;
}
