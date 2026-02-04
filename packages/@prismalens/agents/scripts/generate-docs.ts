#!/usr/bin/env npx tsx
/**
 * Auto-generate documentation from code introspection.
 *
 * Generates docs/GENERATED.md with:
 * - Graph structure (Mermaid diagram from LangGraph)
 * - Tool schemas (from Zod definitions)
 * - Skill metadata (from SKILL.md frontmatter)
 * - State schema (from Zod types)
 *
 * Run with: pnpm docs:generate
 */

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";

// =============================================================================
// TYPES
// =============================================================================

interface ToolInfo {
	name: string;
	description: string;
	schema: Record<string, unknown>;
	agent: string;
}

interface SkillInfo {
	name: string;
	description: string;
	agent: string;
	path: string;
}

interface StateFieldInfo {
	name: string;
	type: string;
	description?: string;
}

interface GraphNodeInfo {
	name: string;
	type: "node" | "edge";
}

// =============================================================================
// GRAPH INTROSPECTION
// =============================================================================

async function getGraphMermaid(): Promise<string> {
	try {
		const { investigationGraph } = await import("../src/graph/graph.js");
		const graphDef = investigationGraph.getGraph();
		return graphDef.drawMermaid();
	} catch (error) {
		console.warn("Could not generate graph mermaid:", error);
		return "```\nGraph generation failed - build the package first with `pnpm build`\n```";
	}
}

// =============================================================================
// TOOL EXTRACTION
// =============================================================================

async function extractTools(): Promise<ToolInfo[]> {
	const tools: ToolInfo[] = [];

	try {
		// Detective tools
		const { createDetectiveTools } = await import("../src/tools/hypothesis.js");
		const detectiveTools = createDetectiveTools();
		for (const tool of detectiveTools) {
			tools.push({
				name: tool.name,
				description: tool.description,
				schema: tool.schema ? zodToJsonSchema(tool.schema as z.ZodType) : {},
				agent: "Detective",
			});
		}
	} catch (error) {
		console.warn("Could not extract detective tools:", error);
	}

	try {
		// Surgeon tools
		const { createSurgeonTools } = await import("../src/tools/fix-proposal.js");
		const surgeonTools = createSurgeonTools();
		for (const tool of surgeonTools) {
			tools.push({
				name: tool.name,
				description: tool.description,
				schema: tool.schema ? zodToJsonSchema(tool.schema as z.ZodType) : {},
				agent: "Surgeon",
			});
		}
	} catch (error) {
		console.warn("Could not extract surgeon tools:", error);
	}

	try {
		// Adversary tools
		const { createAdversaryTools } = await import("../src/tools/challenge.js");
		const adversaryTools = createAdversaryTools();
		for (const tool of adversaryTools) {
			tools.push({
				name: tool.name,
				description: tool.description,
				schema: tool.schema ? zodToJsonSchema(tool.schema as z.ZodType) : {},
				agent: "Adversary",
			});
		}
	} catch (error) {
		console.warn("Could not extract adversary tools:", error);
	}

	try {
		// Repo tools (shared) - requires clonePaths, so we mock them for introspection
		const { createRepoTools } = await import("../src/tools/repo.js");
		const mockOptions = {
			agentName: "code-searcher" as const,
			integrations: [],
			clonePaths: { primary: "/tmp/mock-repo" },
		};
		const repoTools = createRepoTools(mockOptions);
		for (const tool of repoTools) {
			tools.push({
				name: tool.name,
				description: tool.description,
				schema: tool.schema ? zodToJsonSchema(tool.schema as z.ZodType) : {},
				agent: "Gatherers",
			});
		}
	} catch (error) {
		console.warn("Could not extract repo tools:", error);
	}

	try {
		// Handoff tools
		const { createHandoffTools } = await import("../src/tools/handoffs.js");
		const handoffTools = createHandoffTools();
		for (const tool of handoffTools) {
			tools.push({
				name: tool.name,
				description: tool.description,
				schema: tool.schema ? zodToJsonSchema(tool.schema as z.ZodType) : {},
				agent: "Detective",
			});
		}
	} catch (error) {
		console.warn("Could not extract handoff tools:", error);
	}

	return tools;
}

// =============================================================================
// SKILL PARSING
// =============================================================================

async function parseSkillFrontmatter(
	filePath: string,
): Promise<{ name: string; description: string } | null> {
	try {
		const content = await readFile(filePath, "utf-8");
		const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

		if (!frontmatterMatch) {
			return null;
		}

		const frontmatter = frontmatterMatch[1];
		const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
		const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

		return {
			name: nameMatch?.[1]?.trim() || "unknown",
			description: descMatch?.[1]?.trim() || "",
		};
	} catch {
		return null;
	}
}

async function findSkillFiles(dir: string): Promise<string[]> {
	const results: string[] = [];

	async function walk(currentDir: string) {
		try {
			const entries = await readdir(currentDir);
			for (const entry of entries) {
				const fullPath = join(currentDir, entry);
				const stats = await stat(fullPath);

				if (stats.isDirectory()) {
					await walk(fullPath);
				} else if (entry === "SKILL.md") {
					results.push(fullPath);
				}
			}
		} catch {
			// Ignore errors
		}
	}

	await walk(dir);
	return results;
}

async function extractSkills(skillsDir: string): Promise<SkillInfo[]> {
	const skills: SkillInfo[] = [];
	const skillFiles = await findSkillFiles(skillsDir);

	for (const filePath of skillFiles) {
		const frontmatter = await parseSkillFrontmatter(filePath);
		if (frontmatter) {
			// Extract agent name from path (e.g., skills/detective/hypothesis-formation/SKILL.md)
			const relativePath = relative(skillsDir, filePath);
			const parts = relativePath.split("/");
			const agent = parts[0] || "unknown";

			skills.push({
				name: frontmatter.name,
				description: frontmatter.description,
				agent: agent.charAt(0).toUpperCase() + agent.slice(1),
				path: relativePath.replace("/SKILL.md", ""),
			});
		}
	}

	return skills.sort((a, b) => a.agent.localeCompare(b.agent) || a.name.localeCompare(b.name));
}

// =============================================================================
// STATE SCHEMA EXTRACTION
// =============================================================================

async function extractStateFields(): Promise<StateFieldInfo[]> {
	// For now, return a curated list of important state fields
	// Full introspection would require TypeScript compiler API
	return [
		{ name: "investigationId", type: "string", description: "Unique investigation identifier" },
		{ name: "incidentId", type: "string", description: "Incident being investigated" },
		{ name: "phase", type: "SupervisorPhase", description: "Current workflow phase (gathering, analyzing, fixing, complete)" },
		{ name: "findings", type: "Finding[]", description: "Evidence from gatherer agents" },
		{ name: "hypotheses", type: "Hypothesis[]", description: "Root cause hypotheses from Detective" },
		{ name: "recommendations", type: "Recommendation[]", description: "Fix proposals from Surgeon" },
		{ name: "fix", type: "Fix", description: "Final fix proposal" },
		{ name: "status", type: "string", description: "Workflow status (pending, running, completed, failed)" },
		{ name: "confidence", type: "number", description: "Overall confidence score (0-100)" },
	];
}

// =============================================================================
// MARKDOWN GENERATION
// =============================================================================

/**
 * Edge annotations based on workflow semantics.
 * Maps "source|target" to a short label.
 */
const EDGE_ANNOTATIONS: Record<string, string> = {
	// Entry flow
	"__start__|validateIncident": "start",
	"validateIncident|preGather": "valid",
	"validateIncident|writeToApi": "invalid",
	"preGather|cloneIfNeeded": "init",
	"cloneIfNeeded|prepareSupervisor": "ready",
	"prepareSupervisor|supervisor": "begin",

	// Supervisor routing
	"supervisor|gatherer-coordinator": "gather",
	"supervisor|detective": "analyze",
	"supervisor|adversary": "challenge",
	"supervisor|surgeon": "fix",
	"supervisor|qualityGate": "review",
	"supervisor|processHandoff": "handoff",

	// Gatherer flow
	"gatherer-coordinator|log-gatherer": "logs",
	"gatherer-coordinator|code-searcher": "code",
	"gatherer-coordinator|change-tracker": "changes",
	"gatherer-coordinator|processHandoff": "request",
	"gatherer-coordinator|supervisor": "done",
	"log-gatherer|gatherer-coordinator": "findings",
	"code-searcher|gatherer-coordinator": "findings",
	"change-tracker|gatherer-coordinator": "findings",

	// Quality gate
	"qualityGate|supervisor": "retry",
	"qualityGate|detective": "sufficient",

	// Handoff processing
	"processHandoff|detective": "denied",
	"processHandoff|supervisor": "approved",

	// Detective flow
	"detective|processHandoff": "request",
	"detective|adversary": "hypothesis",
	"detective|supervisor": "concluded",

	// Adversary flow
	"adversary|detective": "refine",
	"adversary|supervisor": "approved",

	// Surgeon flow
	"surgeon|supervisor": "proposal",

	// Exit
	"writeToApi|__end__": "done",
};

/**
 * Make mermaid diagram dark-mode compatible and add edge annotations.
 * Uses mermaid's `-. label .->` syntax for dotted lines and `-- label -->` for solid lines.
 */
function enhanceMermaidDiagram(mermaid: string): string {
	const lines = mermaid.split("\n");
	const result: string[] = [];

	for (const line of lines) {
		let processedLine = line;

		// Match edge patterns: source --> target or source -.-> target
		// But skip edges that already have labels (contain &nbsp; or |)
		const edgeMatch = line.match(/^\t(\S+)\s+(-->|-.->)\s+(\S+);$/);

		if (edgeMatch && !line.includes("&nbsp;") && !line.includes("|")) {
			const [, source, arrow, target] = edgeMatch;
			const key = `${source}|${target}`;
			const label = EDGE_ANNOTATIONS[key];

			if (label) {
				if (arrow === "-->") {
					// Solid edge: use -- label --> syntax
					processedLine = `\t${source} -- ${label} --> ${target};`;
				} else {
					// Dotted edge: use -. label .-> syntax
					processedLine = `\t${source} -. ${label} .-> ${target};`;
				}
			}
		}

		// Apply dark mode styling to classDef lines
		processedLine = processedLine
			.replace(/classDef default fill:#f2f0ff,line-height:1\.2;/,
				"classDef default fill:transparent,stroke:#6366f1,stroke-width:2px,color:#e2e8f0;")
			.replace(/classDef first fill-opacity:0;/,
				"classDef first fill:transparent,stroke:#22c55e,stroke-width:2px,color:#e2e8f0;")
			.replace(/classDef last fill:#bfb6fc;/,
				"classDef last fill:transparent,stroke:#a855f7,stroke-width:3px,color:#e2e8f0;");

		result.push(processedLine);
	}

	// Add link styles for better visibility (before the empty line at end)
	const lastClassDefIndex = result.findLastIndex(l => l.includes("classDef"));
	if (lastClassDefIndex !== -1) {
		result.splice(lastClassDefIndex + 1, 0, "\tlinkStyle default stroke:#94a3b8,stroke-width:1.5px;");
	}

	return result.join("\n");
}

/**
 * Get first sentence or first N characters as a short description.
 */
function getShortDescription(desc: string, maxLen = 60): string {
	const firstLine = desc.split("\n")[0];
	const firstSentence = firstLine.split(/\.\s/)[0];
	if (firstSentence.length <= maxLen) {
		return firstSentence.endsWith(".") ? firstSentence : `${firstSentence}.`;
	}
	return `${firstSentence.slice(0, maxLen - 3)}...`;
}

function generateMarkdown(data: {
	mermaid: string;
	tools: ToolInfo[];
	skills: SkillInfo[];
	stateFields: StateFieldInfo[];
	generatedAt: string;
}): string {
	const lines: string[] = [];

	// Header
	lines.push("# @prismalens/agents - Generated Documentation");
	lines.push("");
	lines.push(`> Auto-generated on ${data.generatedAt} | Regenerate: \`pnpm docs:generate\``);
	lines.push("");

	// Quick Stats
	lines.push(`**${data.tools.length} tools** | **${data.skills.length} skills** | **${data.stateFields.length} state fields**`);
	lines.push("");

	// Graph Structure
	lines.push("## Graph Structure");
	lines.push("");
	lines.push("```mermaid");
	lines.push(enhanceMermaidDiagram(data.mermaid));
	lines.push("```");
	lines.push("");

	// State Schema - Compact
	lines.push("## State Schema");
	lines.push("");
	lines.push("| Field | Type | Description |");
	lines.push("|-------|------|-------------|");
	for (const field of data.stateFields) {
		lines.push(`| \`${field.name}\` | \`${field.type}\` | ${field.description || ""} |`);
	}
	lines.push("");

	// Tools - Summary only, details in collapsible
	lines.push("## Tools");
	lines.push("");

	const toolsByAgent = new Map<string, ToolInfo[]>();
	for (const tool of data.tools) {
		const existing = toolsByAgent.get(tool.agent) || [];
		existing.push(tool);
		toolsByAgent.set(tool.agent, existing);
	}

	for (const [agent, agentTools] of toolsByAgent) {
		lines.push(`### ${agent} (${agentTools.length})`);
		lines.push("");
		lines.push("| Tool | Description |");
		lines.push("|------|-------------|");
		for (const tool of agentTools) {
			lines.push(`| \`${tool.name}\` | ${getShortDescription(tool.description)} |`);
		}
		lines.push("");

		// Collapsible details section
		lines.push("<details>");
		lines.push(`<summary>Tool parameters</summary>`);
		lines.push("");
		for (const tool of agentTools) {
			const schema = tool.schema as { properties?: Record<string, { type?: string; description?: string }> };
			if (schema.properties && Object.keys(schema.properties).length > 0) {
				const params = Object.entries(schema.properties)
					.map(([name, prop]) => `\`${name}\` (${prop.type || "any"})`)
					.join(", ");
				lines.push(`- **${tool.name}**: ${params}`);
			}
		}
		lines.push("");
		lines.push("</details>");
		lines.push("");
	}

	// Skills - Compact grouped view
	lines.push("## Skills");
	lines.push("");

	const skillsByAgent = new Map<string, SkillInfo[]>();
	for (const skill of data.skills) {
		const existing = skillsByAgent.get(skill.agent) || [];
		existing.push(skill);
		skillsByAgent.set(skill.agent, existing);
	}

	for (const [agent, agentSkills] of skillsByAgent) {
		lines.push(`### ${agent} (${agentSkills.length})`);
		lines.push("");
		const skillList = agentSkills
			.map(s => `\`${s.name}\``)
			.join(" | ");
		lines.push(skillList);
		lines.push("");

		// Collapsible descriptions
		lines.push("<details>");
		lines.push("<summary>Skill descriptions</summary>");
		lines.push("");
		for (const skill of agentSkills) {
			lines.push(`- **${skill.name}**: ${getShortDescription(skill.description, 80)}`);
		}
		lines.push("");
		lines.push("</details>");
		lines.push("");
	}

	return lines.join("\n");
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
	console.log("🔍 Generating documentation from code...\n");

	const packageDir = new URL("..", import.meta.url).pathname;
	const skillsDir = join(packageDir, "src/skills");
	const outputPath = join(packageDir, "docs/GENERATED.md");

	// Extract data
	console.log("📊 Extracting graph structure...");
	const mermaid = await getGraphMermaid();

	console.log("🔧 Extracting tools...");
	const tools = await extractTools();
	console.log(`   Found ${tools.length} tools`);

	console.log("📚 Extracting skills...");
	const skills = await extractSkills(skillsDir);
	console.log(`   Found ${skills.length} skills`);

	console.log("📋 Extracting state schema...");
	const stateFields = await extractStateFields();

	// Generate markdown
	console.log("\n📝 Generating markdown...");
	const generatedAt = new Date().toISOString().split("T")[0];
	const markdown = generateMarkdown({
		mermaid,
		tools,
		skills,
		stateFields,
		generatedAt,
	});

	// Write output
	await writeFile(outputPath, markdown, "utf-8");
	console.log(`\n✅ Documentation written to ${relative(process.cwd(), outputPath)}`);

	// Summary
	console.log("\n📊 Summary:");
	console.log(`   - Tools: ${tools.length}`);
	console.log(`   - Skills: ${skills.length}`);
	console.log(`   - State fields: ${stateFields.length}`);
}

main().catch((error) => {
	console.error("Failed to generate documentation:", error);
	process.exit(1);
});
