import { z } from "zod";

/**
 * Skills environment variables schema.
 *
 * Optional paths to custom skill directories that override or extend built-in skills.
 * Skills are loaded from SKILL.md files and used by DeepAgents middleware.
 *
 * @see https://agentskills.io/specification
 */
export const skillsSchema = z.object({
	// Per-subagent custom skill directories
	PRISMALENS_CARTOGRAPHER_SKILLS_DIR: z
		.string()
		.optional()
		.describe("Custom skills directory for Cartographer subagent"),

	PRISMALENS_DETECTIVE_SKILLS_DIR: z
		.string()
		.optional()
		.describe("Custom skills directory for Detective subagent"),

	PRISMALENS_SURGEON_SKILLS_DIR: z
		.string()
		.optional()
		.describe("Custom skills directory for Surgeon subagent"),

	// Additional skills directory (merged with built-in)
	PRISMALENS_ADDITIONAL_SKILLS_DIR: z
		.string()
		.optional()
		.describe(
			"Additional skills directory path (merged with built-in skills)",
		),

	// =============================================================================
	// MCP Server Configuration
	// Used for deep code analysis during investigations
	// =============================================================================

	// Code Pathfinder MCP - Call graph analysis
	PRISMALENS_MCP_CODE_PATHFINDER_ENABLED: z
		.string()
		.transform((val) => val === "true")
		.default("false")
		.describe("Enable Code Pathfinder MCP for call graph analysis"),

	PRISMALENS_MCP_CODE_PATHFINDER_PROJECT_PATH: z
		.string()
		.optional()
		.describe("Project path for Code Pathfinder analysis"),

	// Code Index MCP - Multi-language AST indexing
	PRISMALENS_MCP_CODE_INDEX_ENABLED: z
		.string()
		.transform((val) => val === "true")
		.default("false")
		.describe("Enable Code Index MCP for multi-language AST analysis"),

	PRISMALENS_MCP_CODE_INDEX_PROJECT_PATH: z
		.string()
		.optional()
		.describe("Project path for Code Index MCP"),

	// mcp-ripgrep - Fast text search
	PRISMALENS_MCP_RIPGREP_ENABLED: z
		.string()
		.transform((val) => val === "true")
		.default("false")
		.describe("Enable mcp-ripgrep for fast pattern search"),

	PRISMALENS_MCP_RIPGREP_BASE_DIR: z
		.string()
		.optional()
		.describe("Base directory for ripgrep searches"),
});

export type SkillsEnvConfig = z.infer<typeof skillsSchema>;
