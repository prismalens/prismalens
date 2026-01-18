import type { StructuredTool } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";
import type { BundleExecutionContext } from "./bundles/types.js";
import type { ToolFactoryOptions } from "./factory.js";

// =============================================================================
// REPO TOOLS
// =============================================================================
// Tools for interacting with local repository files.
// Sandboxed to work within configured base paths only.
// =============================================================================

/**
 * Get base path for repo tools from integrations or environment
 */
function getBasePath(integrations: ToolFactoryOptions["integrations"]): string {
	// Check integrations for configured repo paths
	const repoIntegration = integrations.find(
		(i) => i.type.toLowerCase() === "repo",
	);
	if (repoIntegration?.config?.basePath) {
		return repoIntegration.config.basePath as string;
	}

	// Fall back to environment variable or current directory
	return process.env.REPO_BASE_PATH || process.cwd();
}

/**
 * Validate that a path is within the allowed base path (sandbox protection)
 */
function validatePath(basePath: string, targetPath: string): string {
	const resolvedBase = path.resolve(basePath);
	const resolvedTarget = path.resolve(basePath, targetPath);

	if (!resolvedTarget.startsWith(resolvedBase)) {
		throw new Error(
			`Access denied: Path "${targetPath}" is outside the allowed directory`,
		);
	}

	return resolvedTarget;
}

/**
 * Create local repository tools for an agent.
 */
export function createRepoTools(options: ToolFactoryOptions): StructuredTool[] {
	const basePath = getBasePath(options.integrations);

	const tools: StructuredTool[] = [
		// Read file from local repository
		tool(
			async ({ filePath }) => {
				try {
					const fullPath = validatePath(basePath, filePath);
					const content = await fs.readFile(fullPath, "utf-8");

					// Limit output size to avoid context overflow
					const MAX_SIZE = 50000;
					if (content.length > MAX_SIZE) {
						return `${content.substring(0, MAX_SIZE)}\n\n... [truncated, file is ${content.length} characters]`;
					}

					return content;
				} catch (error: any) {
					if (error.code === "ENOENT") {
						return `File not found: ${filePath}`;
					}
					return `Error reading file: ${error.message}`;
				}
			},
			{
				name: "repo_read_file",
				description:
					"Read contents of a file from the local repository. Returns the file content as text.",
				schema: z.object({
					filePath: z
						.string()
						.describe("Relative path to the file within the repository"),
				}),
			},
		),

		// List directory contents
		tool(
			async ({ dirPath, recursive }) => {
				try {
					const fullPath = validatePath(basePath, dirPath || ".");

					const listDir = async (
						currentPath: string,
						depth: number = 0,
					): Promise<any[]> => {
						const entries = await fs.readdir(currentPath, {
							withFileTypes: true,
						});
						const results: any[] = [];

						for (const entry of entries) {
							// Skip hidden files and common ignore patterns
							if (
								entry.name.startsWith(".") ||
								entry.name === "node_modules" ||
								entry.name === "__pycache__" ||
								entry.name === "dist" ||
								entry.name === "build"
							) {
								continue;
							}

							const relativePath = path.relative(
								basePath,
								path.join(currentPath, entry.name),
							);

							const item: any = {
								name: entry.name,
								path: relativePath,
								type: entry.isDirectory() ? "directory" : "file",
							};

							if (entry.isFile()) {
								const stats = await fs.stat(path.join(currentPath, entry.name));
								item.size = stats.size;
							}

							results.push(item);

							// Recursively list subdirectories (limited depth)
							if (recursive && entry.isDirectory() && depth < 3) {
								const subItems = await listDir(
									path.join(currentPath, entry.name),
									depth + 1,
								);
								results.push(...subItems);
							}
						}

						return results;
					};

					const items = await listDir(fullPath);
					return JSON.stringify(items, null, 2);
				} catch (error: any) {
					if (error.code === "ENOENT") {
						return `Directory not found: ${dirPath}`;
					}
					return `Error listing directory: ${error.message}`;
				}
			},
			{
				name: "repo_list_directory",
				description:
					"List contents of a directory in the local repository. Returns file and folder information.",
				schema: z.object({
					dirPath: z
						.string()
						.optional()
						.describe("Relative path to directory (empty for root)"),
					recursive: z
						.boolean()
						.optional()
						.default(false)
						.describe("Include subdirectories recursively (max 3 levels)"),
				}),
			},
		),

		// Search for text in files
		tool(
			async ({ pattern, fileExtension, dirPath }) => {
				try {
					const searchPath = validatePath(basePath, dirPath || ".");
					const results: any[] = [];
					const maxResults = 50;

					const searchDir = async (currentPath: string): Promise<void> => {
						if (results.length >= maxResults) return;

						const entries = await fs.readdir(currentPath, {
							withFileTypes: true,
						});

						for (const entry of entries) {
							if (results.length >= maxResults) return;

							// Skip ignored directories
							if (
								entry.isDirectory() &&
								(entry.name.startsWith(".") ||
									entry.name === "node_modules" ||
									entry.name === "__pycache__" ||
									entry.name === "dist" ||
									entry.name === "build")
							) {
								continue;
							}

							const fullEntryPath = path.join(currentPath, entry.name);

							if (entry.isDirectory()) {
								await searchDir(fullEntryPath);
							} else if (entry.isFile()) {
								// Check file extension filter
								if (
									fileExtension &&
									!entry.name.endsWith(`.${fileExtension}`)
								) {
									continue;
								}

								try {
									const content = await fs.readFile(fullEntryPath, "utf-8");
									const lines = content.split("\n");

									for (let i = 0; i < lines.length; i++) {
										if (lines[i].includes(pattern)) {
											results.push({
												file: path.relative(basePath, fullEntryPath),
												line: i + 1,
												content: lines[i].trim().substring(0, 200),
											});

											if (results.length >= maxResults) break;
										}
									}
								} catch {
									// Skip binary files or files we can't read
								}
							}
						}
					};

					await searchDir(searchPath);

					if (results.length === 0) {
						return `No matches found for "${pattern}"`;
					}

					return JSON.stringify(results, null, 2);
				} catch (error: any) {
					return `Error searching: ${error.message}`;
				}
			},
			{
				name: "repo_search_text",
				description:
					"Search for text pattern in repository files. Returns matching lines with file paths.",
				schema: z.object({
					pattern: z.string().describe("Text pattern to search for"),
					fileExtension: z
						.string()
						.optional()
						.describe('Filter by file extension (e.g., "ts", "py")'),
					dirPath: z
						.string()
						.optional()
						.describe("Directory to search in (defaults to root)"),
				}),
			},
		),

		// Get file metadata
		tool(
			async ({ filePath }) => {
				try {
					const fullPath = validatePath(basePath, filePath);
					const stats = await fs.stat(fullPath);

					return JSON.stringify(
						{
							path: filePath,
							size: stats.size,
							isDirectory: stats.isDirectory(),
							isFile: stats.isFile(),
							created: stats.birthtime.toISOString(),
							modified: stats.mtime.toISOString(),
							accessed: stats.atime.toISOString(),
						},
						null,
						2,
					);
				} catch (error: any) {
					if (error.code === "ENOENT") {
						return `Path not found: ${filePath}`;
					}
					return `Error getting file info: ${error.message}`;
				}
			},
			{
				name: "repo_get_file_info",
				description:
					"Get metadata about a file or directory in the repository.",
				schema: z.object({
					filePath: z
						.string()
						.describe("Relative path to the file or directory"),
				}),
			},
		),
	];

	return tools;
}

// Legacy export for backward compatibility
export const repoTools = createRepoTools({
	agentName: "default",
	integrations: [],
});

// =============================================================================
// BUNDLE FACTORY EXPORTS
// =============================================================================

/**
 * Get base path from bundle context
 */
function getBasePathFromContext(context: BundleExecutionContext): string {
	return getBasePath(context.integrations);
}

/**
 * Create repo tools from bundle context.
 * Used by the progressive disclosure system.
 */
export function createRepoFilesBundle(
	context: BundleExecutionContext,
): StructuredTool[] {
	const basePath = getBasePathFromContext(context);
	return createRepoToolsInternal(basePath);
}

/**
 * Internal function to create tools with a base path.
 * Shared between legacy and bundle factory paths.
 */
function createRepoToolsInternal(basePath: string): StructuredTool[] {
	return [
		// Read file from local repository
		tool(
			async ({ filePath }) => {
				try {
					const fullPath = validatePath(basePath, filePath);
					const content = await fs.readFile(fullPath, "utf-8");

					// Limit output size to avoid context overflow
					const MAX_SIZE = 50000;
					if (content.length > MAX_SIZE) {
						return `${content.substring(0, MAX_SIZE)}\n\n... [truncated, file is ${content.length} characters]`;
					}

					return content;
				} catch (error: unknown) {
					const nodeError = error as { code?: string; message?: string };
					if (nodeError.code === "ENOENT") {
						return `File not found: ${filePath}`;
					}
					return `Error reading file: ${nodeError.message || "Unknown error"}`;
				}
			},
			{
				name: "repo_read_file",
				description:
					"Read contents of a file from the local repository. Returns the file content as text.",
				schema: z.object({
					filePath: z
						.string()
						.describe("Relative path to the file within the repository"),
				}),
			},
		),

		// List directory contents
		tool(
			async ({ dirPath, recursive }) => {
				try {
					const fullPath = validatePath(basePath, dirPath || ".");

					const listDir = async (
						currentPath: string,
						depth: number = 0,
					): Promise<Array<Record<string, unknown>>> => {
						const entries = await fs.readdir(currentPath, {
							withFileTypes: true,
						});
						const results: Array<Record<string, unknown>> = [];

						for (const entry of entries) {
							// Skip hidden files and common ignore patterns
							if (
								entry.name.startsWith(".") ||
								entry.name === "node_modules" ||
								entry.name === "__pycache__" ||
								entry.name === "dist" ||
								entry.name === "build"
							) {
								continue;
							}

							const relativePath = path.relative(
								basePath,
								path.join(currentPath, entry.name),
							);

							const item: Record<string, unknown> = {
								name: entry.name,
								path: relativePath,
								type: entry.isDirectory() ? "directory" : "file",
							};

							if (entry.isFile()) {
								const stats = await fs.stat(path.join(currentPath, entry.name));
								item.size = stats.size;
							}

							results.push(item);

							// Recursively list subdirectories (limited depth)
							if (recursive && entry.isDirectory() && depth < 3) {
								const subItems = await listDir(
									path.join(currentPath, entry.name),
									depth + 1,
								);
								results.push(...subItems);
							}
						}

						return results;
					};

					const items = await listDir(fullPath);
					return JSON.stringify(items, null, 2);
				} catch (error: unknown) {
					const nodeError = error as { code?: string; message?: string };
					if (nodeError.code === "ENOENT") {
						return `Directory not found: ${dirPath}`;
					}
					return `Error listing directory: ${nodeError.message || "Unknown error"}`;
				}
			},
			{
				name: "repo_list_directory",
				description:
					"List contents of a directory in the local repository. Returns file and folder information.",
				schema: z.object({
					dirPath: z
						.string()
						.optional()
						.describe("Relative path to directory (empty for root)"),
					recursive: z
						.boolean()
						.optional()
						.default(false)
						.describe("Include subdirectories recursively (max 3 levels)"),
				}),
			},
		),

		// Search for text in files
		tool(
			async ({ pattern, fileExtension, dirPath }) => {
				try {
					const searchPath = validatePath(basePath, dirPath || ".");
					const results: Array<Record<string, unknown>> = [];
					const maxResults = 50;

					const searchDir = async (currentPath: string): Promise<void> => {
						if (results.length >= maxResults) return;

						const entries = await fs.readdir(currentPath, {
							withFileTypes: true,
						});

						for (const entry of entries) {
							if (results.length >= maxResults) return;

							// Skip ignored directories
							if (
								entry.isDirectory() &&
								(entry.name.startsWith(".") ||
									entry.name === "node_modules" ||
									entry.name === "__pycache__" ||
									entry.name === "dist" ||
									entry.name === "build")
							) {
								continue;
							}

							const fullEntryPath = path.join(currentPath, entry.name);

							if (entry.isDirectory()) {
								await searchDir(fullEntryPath);
							} else if (entry.isFile()) {
								// Check file extension filter
								if (
									fileExtension &&
									!entry.name.endsWith(`.${fileExtension}`)
								) {
									continue;
								}

								try {
									const content = await fs.readFile(fullEntryPath, "utf-8");
									const lines = content.split("\n");

									for (let i = 0; i < lines.length; i++) {
										if (lines[i].includes(pattern)) {
											results.push({
												file: path.relative(basePath, fullEntryPath),
												line: i + 1,
												content: lines[i].trim().substring(0, 200),
											});

											if (results.length >= maxResults) break;
										}
									}
								} catch {
									// Skip binary files or files we can't read
								}
							}
						}
					};

					await searchDir(searchPath);

					if (results.length === 0) {
						return `No matches found for "${pattern}"`;
					}

					return JSON.stringify(results, null, 2);
				} catch (error: unknown) {
					const nodeError = error as { message?: string };
					return `Error searching: ${nodeError.message || "Unknown error"}`;
				}
			},
			{
				name: "repo_search_text",
				description:
					"Search for text pattern in repository files. Returns matching lines with file paths.",
				schema: z.object({
					pattern: z.string().describe("Text pattern to search for"),
					fileExtension: z
						.string()
						.optional()
						.describe('Filter by file extension (e.g., "ts", "py")'),
					dirPath: z
						.string()
						.optional()
						.describe("Directory to search in (defaults to root)"),
				}),
			},
		),

		// Get file metadata
		tool(
			async ({ filePath }) => {
				try {
					const fullPath = validatePath(basePath, filePath);
					const stats = await fs.stat(fullPath);

					return JSON.stringify(
						{
							path: filePath,
							size: stats.size,
							isDirectory: stats.isDirectory(),
							isFile: stats.isFile(),
							created: stats.birthtime.toISOString(),
							modified: stats.mtime.toISOString(),
							accessed: stats.atime.toISOString(),
						},
						null,
						2,
					);
				} catch (error: unknown) {
					const nodeError = error as { code?: string; message?: string };
					if (nodeError.code === "ENOENT") {
						return `Path not found: ${filePath}`;
					}
					return `Error getting file info: ${nodeError.message || "Unknown error"}`;
				}
			},
			{
				name: "repo_get_file_info",
				description:
					"Get metadata about a file or directory in the repository.",
				schema: z.object({
					filePath: z
						.string()
						.describe("Relative path to the file or directory"),
				}),
			},
		),
	];
}
