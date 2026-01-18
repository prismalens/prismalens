import { tool } from "@langchain/core/tools";
import { describe, expect, it, beforeEach } from "vitest";
import { z } from "zod";
import { BundleRegistry } from "../../../src/tools/bundles/registry.js";
import { NativeBundleSource } from "../../../src/tools/bundles/sources/native.js";
import type { BundleExecutionContext } from "../../../src/tools/bundles/types.js";

// Helper to create a mock tool
function createMockTool(name: string, description: string) {
	return tool(async () => `Result from ${name}`, {
		name,
		description,
		schema: z.object({}),
	});
}

// Helper to create a context
function createContext(agentName: string = "test-agent"): BundleExecutionContext {
	return {
		integrations: [],
		agentName,
		readOnly: false,
	};
}

describe("BundleRegistry", () => {
	let registry: BundleRegistry;
	let source: NativeBundleSource;

	beforeEach(() => {
		source = new NativeBundleSource({
			bundles: [
				{
					name: "github-code",
					category: "github",
					description: "GitHub code tools",
					readOnly: true,
					keywords: ["github", "code", "search"],
					tools: [
						createMockTool("github_get_file", "Get file from GitHub"),
						createMockTool("github_search_code", "Search code in GitHub"),
					],
				},
				{
					name: "render-logs",
					category: "render",
					description: "Render log tools",
					readOnly: true,
					keywords: ["render", "logs", "deployment"],
					tools: [createMockTool("render_get_logs", "Get Render logs")],
				},
				{
					name: "github-issues",
					category: "github",
					description: "GitHub issue tools",
					readOnly: false, // Write operations
					tools: [createMockTool("github_create_issue", "Create GitHub issue")],
				},
			],
		});

		registry = new BundleRegistry({
			sources: [source],
			agentPermissions: {
				cartographer: ["github", "render"],
				detective: [],
			},
			readOnlyAgents: new Set(["cartographer"]),
		});
	});

	describe("listBundles", () => {
		it("should list all bundles from sources", async () => {
			const bundles = await registry.listBundles();

			expect(bundles).toHaveLength(3);
			expect(bundles.map((b) => b.name)).toContain("github-code");
			expect(bundles.map((b) => b.name)).toContain("render-logs");
			expect(bundles.map((b) => b.name)).toContain("github-issues");
		});

		it("should filter by category", async () => {
			const bundles = await registry.listBundles("github");

			expect(bundles).toHaveLength(2);
			expect(bundles.every((b) => b.category === "github")).toBe(true);
		});
	});

	describe("getMetadata", () => {
		it("should return metadata for existing bundle", async () => {
			const metadata = await registry.getMetadata("github-code");

			expect(metadata).not.toBeNull();
			expect(metadata?.name).toBe("github-code");
			expect(metadata?.category).toBe("github");
			expect(metadata?.readOnly).toBe(true);
		});

		it("should return null for non-existent bundle", async () => {
			const metadata = await registry.getMetadata("non-existent");

			expect(metadata).toBeNull();
		});
	});

	describe("searchBundles", () => {
		it("should search by query", async () => {
			const results = await registry.searchBundles({ query: "github" });

			expect(results.length).toBeGreaterThan(0);
			expect(results[0].bundle.name).toContain("github");
		});

		it("should filter by category", async () => {
			const results = await registry.searchBundles({
				query: "tools",
				category: "render",
			});

			expect(results.every((r) => r.bundle.category === "render")).toBe(true);
		});

		it("should filter read-only bundles", async () => {
			const results = await registry.searchBundles({
				readOnlyOnly: true,
			});

			expect(results.every((r) => r.bundle.readOnly === true)).toBe(true);
		});

		it("should exclude already enabled bundles", async () => {
			const results = await registry.searchBundles({
				excludeEnabled: ["github-code", "render-logs"],
			});

			expect(results.every((r) => r.bundle.name !== "github-code")).toBe(true);
			expect(results.every((r) => r.bundle.name !== "render-logs")).toBe(true);
		});

		it("should respect limit", async () => {
			const results = await registry.searchBundles({ limit: 1 });

			expect(results).toHaveLength(1);
		});
	});

	describe("loadBundle", () => {
		it("should load bundle with tools", async () => {
			const context = createContext("commander");
			const bundle = await registry.loadBundle("github-code", context);

			expect(bundle).not.toBeNull();
			expect(bundle?.metadata.name).toBe("github-code");

			const tools = bundle?.createTools(context);
			expect(tools).toHaveLength(2);
			expect(tools?.map((t) => t.name)).toContain("github_get_file");
		});

		it("should return null for non-existent bundle", async () => {
			const context = createContext();
			const bundle = await registry.loadBundle("non-existent", context);

			expect(bundle).toBeNull();
		});

		it("should respect agent permissions", async () => {
			// Detective has no permissions
			const context = createContext("detective");
			const bundle = await registry.loadBundle("github-code", context);

			expect(bundle).toBeNull();
		});

		it("should enforce read-only mode for read-only agents", async () => {
			// Cartographer is read-only, github-issues has write operations
			const context: BundleExecutionContext = {
				integrations: [],
				agentName: "cartographer",
				readOnly: true,
			};

			const bundle = await registry.loadBundle("github-issues", context);

			expect(bundle).toBeNull();
		});

		it("should allow read-only bundles for read-only agents", async () => {
			const context: BundleExecutionContext = {
				integrations: [],
				agentName: "cartographer",
				readOnly: true,
			};

			const bundle = await registry.loadBundle("github-code", context);

			expect(bundle).not.toBeNull();
		});
	});

	describe("createToolsFromBundles", () => {
		it("should create tools from multiple bundles", async () => {
			const tools = await registry.createToolsFromBundles({
				agentName: "commander",
				integrations: [],
				enabledBundles: ["github-code", "render-logs"],
			});

			expect(tools).toHaveLength(3);
			expect(tools.map((t) => t.name)).toContain("github_get_file");
			expect(tools.map((t) => t.name)).toContain("render_get_logs");
		});

		it("should skip bundles the agent cannot access", async () => {
			const tools = await registry.createToolsFromBundles({
				agentName: "detective", // No permissions
				integrations: [],
				enabledBundles: ["github-code"],
			});

			expect(tools).toHaveLength(0);
		});
	});

	describe("permissions", () => {
		it("should check agent permissions", () => {
			expect(registry.hasPermission("cartographer", "github")).toBe(true);
			expect(registry.hasPermission("cartographer", "render")).toBe(true);
			expect(registry.hasPermission("detective", "github")).toBe(false);
		});

		it("should allow setting permissions", () => {
			registry.setPermissions("detective", ["github"]);

			expect(registry.hasPermission("detective", "github")).toBe(true);
		});

		it("should check read-only status", () => {
			expect(registry.isReadOnly("cartographer")).toBe(true);
			expect(registry.isReadOnly("commander")).toBe(false);
		});

		it("should allow setting read-only status", () => {
			registry.setReadOnly("commander", true);

			expect(registry.isReadOnly("commander")).toBe(true);
		});
	});

	describe("getStats", () => {
		it("should return registry statistics", async () => {
			await registry.initialize();
			const stats = registry.getStats();

			expect(stats.bundleCount).toBe(3);
			expect(stats.sourceCount).toBe(1);
			expect(stats.categories).toContain("github");
			expect(stats.categories).toContain("render");
		});
	});
});
