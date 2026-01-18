import { tool } from "@langchain/core/tools";
import { describe, expect, it } from "vitest";
import { z } from "zod";
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

describe("NativeBundleSource", () => {
	describe("with static tools", () => {
		it("should list bundles with tool names", async () => {
			const source = new NativeBundleSource({
				bundles: [
					{
						name: "test-bundle",
						category: "test",
						description: "Test bundle",
						readOnly: true,
						tools: [
							createMockTool("tool_a", "Tool A"),
							createMockTool("tool_b", "Tool B"),
						],
					},
				],
			});

			const bundles = await source.listBundles();

			expect(bundles).toHaveLength(1);
			expect(bundles[0].name).toBe("test-bundle");
			expect(bundles[0].operations).toEqual(["tool_a", "tool_b"]);
		});

		it("should load bundle and create tools", async () => {
			const source = new NativeBundleSource({
				bundles: [
					{
						name: "test-bundle",
						category: "test",
						description: "Test bundle",
						readOnly: true,
						tools: [
							createMockTool("tool_a", "Tool A"),
							createMockTool("tool_b", "Tool B"),
						],
					},
				],
			});

			const context = createContext();
			const bundle = await source.loadBundle("test-bundle", context);

			expect(bundle).not.toBeNull();
			const tools = bundle!.createTools(context);
			expect(tools).toHaveLength(2);
		});

		it("should return null for non-existent bundle", async () => {
			const source = new NativeBundleSource({ bundles: [] });

			const bundle = await source.loadBundle("non-existent", createContext());

			expect(bundle).toBeNull();
		});
	});

	describe("with factory function", () => {
		it("should call factory with context", async () => {
			let capturedContext: BundleExecutionContext | null = null;

			const source = new NativeBundleSource({
				bundles: [
					{
						name: "factory-bundle",
						category: "test",
						description: "Factory bundle",
						readOnly: true,
						tools: (ctx) => {
							capturedContext = ctx;
							return [createMockTool("dynamic_tool", "Dynamic Tool")];
						},
					},
				],
			});

			const context = createContext("my-agent");
			const bundle = await source.loadBundle("factory-bundle", context);
			const tools = bundle!.createTools(context);

			expect(capturedContext).toEqual(context);
			expect(tools).toHaveLength(1);
			expect(tools[0].name).toBe("dynamic_tool");
		});

		it("should return empty operations for factory bundles in metadata", async () => {
			const source = new NativeBundleSource({
				bundles: [
					{
						name: "factory-bundle",
						category: "test",
						description: "Factory bundle",
						readOnly: true,
						tools: () => [createMockTool("tool", "Tool")],
					},
				],
			});

			const bundles = await source.listBundles();

			// Factory bundles can't know operations until called
			expect(bundles[0].operations).toEqual([]);
		});
	});

	describe("registerBundle", () => {
		it("should allow registering bundles dynamically", async () => {
			const source = new NativeBundleSource({ bundles: [] });

			source.registerBundle({
				name: "dynamic-bundle",
				category: "test",
				description: "Dynamically registered",
				readOnly: true,
				tools: [createMockTool("dynamic_tool", "Dynamic")],
			});

			const bundles = await source.listBundles();

			expect(bundles).toHaveLength(1);
			expect(bundles[0].name).toBe("dynamic-bundle");
		});
	});

	describe("metadata fields", () => {
		it("should include all metadata in bundle listing", async () => {
			const source = new NativeBundleSource({
				bundles: [
					{
						name: "full-bundle",
						category: "test",
						description: "Full metadata bundle",
						readOnly: true,
						estimatedTokens: 500,
						keywords: ["test", "full"],
						useCases: ["Testing", "Validation"],
						tools: [createMockTool("tool", "Tool")],
					},
				],
			});

			const bundles = await source.listBundles();
			const metadata = bundles[0];

			expect(metadata.estimatedTokens).toBe(500);
			expect(metadata.keywords).toEqual(["test", "full"]);
			expect(metadata.useCases).toEqual(["Testing", "Validation"]);
			expect(metadata.source).toBe("native");
		});
	});
});
