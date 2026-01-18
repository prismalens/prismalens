import { Logger } from "@prismalens/logger";
import type {
	ToolManifest,
	ToolManifestFrontmatter,
	ToolManifestOperation,
} from "./types.js";

// =============================================================================
// TOOLS.MD MANIFEST PARSER
// =============================================================================
// Parses TOOLS.md files into structured bundle metadata.
// Similar to skill SKILL.md parsing but for tool bundles.
// =============================================================================

const logger = new Logger({ context: "ManifestParser" });

/**
 * Parse TOOLS.md frontmatter (YAML between --- delimiters).
 */
function parseFrontmatter(content: string): {
	frontmatter: ToolManifestFrontmatter;
	body: string;
} {
	const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
	const match = content.match(frontmatterRegex);

	if (!match) {
		throw new Error("Invalid TOOLS.md format: missing frontmatter");
	}

	const yamlContent = match[1];
	const body = match[2];

	// Parse YAML manually (simple key: value format)
	const frontmatter: Record<string, unknown> = {};
	const lines = yamlContent.split("\n");

	for (const line of lines) {
		const colonIndex = line.indexOf(":");
		if (colonIndex === -1) continue;

		const key = line.substring(0, colonIndex).trim();
		let value: unknown = line.substring(colonIndex + 1).trim();

		// Parse boolean values
		if (value === "true") value = true;
		else if (value === "false") value = false;
		// Parse number values
		else if (/^\d+$/.test(value as string)) value = parseInt(value as string);
		// Parse array values (simple comma-separated)
		else if (
			typeof value === "string" &&
			value.startsWith("[") &&
			value.endsWith("]")
		) {
			value = value
				.slice(1, -1)
				.split(",")
				.map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
		}

		frontmatter[key] = value;
	}

	// Validate required fields
	if (!frontmatter.name || typeof frontmatter.name !== "string") {
		throw new Error("TOOLS.md frontmatter missing required field: name");
	}
	if (!frontmatter.category || typeof frontmatter.category !== "string") {
		throw new Error("TOOLS.md frontmatter missing required field: category");
	}
	if (!frontmatter.description || typeof frontmatter.description !== "string") {
		throw new Error("TOOLS.md frontmatter missing required field: description");
	}
	if (typeof frontmatter.readOnly !== "boolean") {
		// Default to true for safety
		frontmatter.readOnly = true;
	}

	return {
		frontmatter: frontmatter as unknown as ToolManifestFrontmatter,
		body,
	};
}

/**
 * Parse operations from the ## Operations section.
 * Format: - tool_name: Description text
 */
function parseOperations(body: string): ToolManifestOperation[] {
	const operations: ToolManifestOperation[] = [];

	// Find the Operations section
	const operationsMatch = body.match(
		/## Operations\s*\n([\s\S]*?)(?=\n##|$)/i,
	);
	if (!operationsMatch) {
		return operations;
	}

	const operationsSection = operationsMatch[1];
	const lines = operationsSection.split("\n");

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("-")) continue;

		// Parse "- tool_name: Description" format
		const content = trimmed.substring(1).trim();
		const colonIndex = content.indexOf(":");
		if (colonIndex === -1) continue;

		const name = content.substring(0, colonIndex).trim();
		const description = content.substring(colonIndex + 1).trim();

		if (name && description) {
			operations.push({ name, description });
		}
	}

	return operations;
}

/**
 * Parse use cases from the ## Use Cases section.
 * Format: - Use case description
 */
function parseUseCases(body: string): string[] {
	const useCases: string[] = [];

	// Find the Use Cases section
	const useCasesMatch = body.match(/## Use Cases\s*\n([\s\S]*?)(?=\n##|$)/i);
	if (!useCasesMatch) {
		return useCases;
	}

	const useCasesSection = useCasesMatch[1];
	const lines = useCasesSection.split("\n");

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("-")) continue;

		const useCase = trimmed.substring(1).trim();
		if (useCase) {
			useCases.push(useCase);
		}
	}

	return useCases;
}

/**
 * Parse a TOOLS.md file content into a structured manifest.
 *
 * @example
 * const manifest = parseToolsManifest(`
 * ---
 * name: github-code
 * category: github
 * description: Read and search code in GitHub repositories
 * readOnly: true
 * estimatedTokens: 800
 * ---
 *
 * # GitHub Code Tools
 *
 * ## Operations
 * - github_get_file: Read file contents
 * - github_search_code: Search for code patterns
 *
 * ## Use Cases
 * - Finding where errors are thrown
 * - Searching for function definitions
 * `);
 */
export function parseToolsManifest(content: string): ToolManifest {
	try {
		const { frontmatter, body } = parseFrontmatter(content);
		const operations = parseOperations(body);
		const useCases = parseUseCases(body);

		return {
			frontmatter,
			operations,
			useCases,
			rawContent: content,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error(`Failed to parse TOOLS.md: ${message}`);
		throw error;
	}
}

/**
 * Validate that a manifest has matching operations with actual tools.
 * Used to ensure TOOLS.md is in sync with the implementation.
 */
export function validateManifestOperations(
	manifest: ToolManifest,
	actualToolNames: string[],
): { valid: boolean; missing: string[]; extra: string[] } {
	const declaredOps = new Set(manifest.operations.map((op) => op.name));
	const actualOps = new Set(actualToolNames);

	const missing = [...declaredOps].filter((op) => !actualOps.has(op));
	const extra = [...actualOps].filter((op) => !declaredOps.has(op));

	return {
		valid: missing.length === 0 && extra.length === 0,
		missing,
		extra,
	};
}

/**
 * Convert manifest to bundle metadata.
 */
export function manifestToMetadata(
	manifest: ToolManifest,
	source?: string,
): {
	name: string;
	category: string;
	description: string;
	operations: string[];
	readOnly: boolean;
	estimatedTokens?: number;
	keywords?: string[];
	useCases?: string[];
	source?: string;
} {
	return {
		name: manifest.frontmatter.name,
		category: manifest.frontmatter.category,
		description: manifest.frontmatter.description,
		operations: manifest.operations.map((op) => op.name),
		readOnly: manifest.frontmatter.readOnly,
		estimatedTokens: manifest.frontmatter.estimatedTokens,
		keywords: manifest.frontmatter.keywords,
		useCases: manifest.useCases.length > 0 ? manifest.useCases : undefined,
		source,
	};
}
