import { describe, expect, it } from "vitest";
import {
	manifestToMetadata,
	parseToolsManifest,
	validateManifestOperations,
} from "../../../src/tools/bundles/manifest.js";

describe("TOOLS.md Manifest Parser", () => {
	describe("parseToolsManifest", () => {
		it("should parse valid manifest with all fields", () => {
			const content = `---
name: github-code
category: github
description: Read and search code in GitHub repositories
readOnly: true
estimatedTokens: 800
keywords: [github, code, search]
---

# GitHub Code Tools

## Operations
- github_get_file: Read file contents from a repository
- github_search_code: Search for code patterns

## Use Cases
- Finding where errors are thrown
- Searching for function definitions
`;

			const manifest = parseToolsManifest(content);

			expect(manifest.frontmatter.name).toBe("github-code");
			expect(manifest.frontmatter.category).toBe("github");
			expect(manifest.frontmatter.description).toBe(
				"Read and search code in GitHub repositories",
			);
			expect(manifest.frontmatter.readOnly).toBe(true);
			expect(manifest.frontmatter.estimatedTokens).toBe(800);
			expect(manifest.operations).toHaveLength(2);
			expect(manifest.operations[0]).toEqual({
				name: "github_get_file",
				description: "Read file contents from a repository",
			});
			expect(manifest.useCases).toHaveLength(2);
		});

		it("should default readOnly to true if not specified", () => {
			const content = `---
name: test-bundle
category: test
description: Test bundle
---

# Test

## Operations
- test_op: Test operation
`;

			const manifest = parseToolsManifest(content);
			expect(manifest.frontmatter.readOnly).toBe(true);
		});

		it("should throw on missing required fields", () => {
			const content = `---
category: github
description: Missing name field
---

# Test
`;

			expect(() => parseToolsManifest(content)).toThrow(
				"missing required field: name",
			);
		});

		it("should throw on missing frontmatter", () => {
			const content = `# No frontmatter

Just content.
`;

			expect(() => parseToolsManifest(content)).toThrow("missing frontmatter");
		});

		it("should handle empty operations section", () => {
			const content = `---
name: empty-ops
category: test
description: No operations
readOnly: true
---

# Empty

No operations section here.
`;

			const manifest = parseToolsManifest(content);
			expect(manifest.operations).toHaveLength(0);
		});

		it("should handle empty use cases section", () => {
			const content = `---
name: no-cases
category: test
description: No use cases
readOnly: true
---

# Test

## Operations
- test_op: Test operation
`;

			const manifest = parseToolsManifest(content);
			expect(manifest.useCases).toHaveLength(0);
		});
	});

	describe("validateManifestOperations", () => {
		it("should validate matching operations", () => {
			const manifest = parseToolsManifest(`---
name: test
category: test
description: Test
readOnly: true
---

## Operations
- op_a: Operation A
- op_b: Operation B
`);

			const result = validateManifestOperations(manifest, ["op_a", "op_b"]);

			expect(result.valid).toBe(true);
			expect(result.missing).toHaveLength(0);
			expect(result.extra).toHaveLength(0);
		});

		it("should detect missing operations", () => {
			const manifest = parseToolsManifest(`---
name: test
category: test
description: Test
readOnly: true
---

## Operations
- op_a: Operation A
- op_b: Operation B
- op_c: Operation C
`);

			const result = validateManifestOperations(manifest, ["op_a", "op_b"]);

			expect(result.valid).toBe(false);
			expect(result.missing).toEqual(["op_c"]);
		});

		it("should detect extra operations", () => {
			const manifest = parseToolsManifest(`---
name: test
category: test
description: Test
readOnly: true
---

## Operations
- op_a: Operation A
`);

			const result = validateManifestOperations(manifest, [
				"op_a",
				"op_b",
				"op_c",
			]);

			expect(result.valid).toBe(false);
			expect(result.extra).toEqual(["op_b", "op_c"]);
		});
	});

	describe("manifestToMetadata", () => {
		it("should convert manifest to metadata", () => {
			const manifest = parseToolsManifest(`---
name: github-code
category: github
description: GitHub code tools
readOnly: true
estimatedTokens: 900
keywords: [github, code]
---

## Operations
- github_get_file: Get file
- github_search: Search code

## Use Cases
- Finding errors
- Code search
`);

			const metadata = manifestToMetadata(manifest, "filesystem");

			expect(metadata).toEqual({
				name: "github-code",
				category: "github",
				description: "GitHub code tools",
				operations: ["github_get_file", "github_search"],
				readOnly: true,
				estimatedTokens: 900,
				keywords: ["github", "code"],
				useCases: ["Finding errors", "Code search"],
				source: "filesystem",
			});
		});

		it("should handle optional fields", () => {
			const manifest = parseToolsManifest(`---
name: minimal
category: test
description: Minimal manifest
readOnly: false
---

## Operations
- test_op: Test
`);

			const metadata = manifestToMetadata(manifest);

			expect(metadata.name).toBe("minimal");
			expect(metadata.estimatedTokens).toBeUndefined();
			expect(metadata.keywords).toBeUndefined();
			expect(metadata.useCases).toBeUndefined();
			expect(metadata.source).toBeUndefined();
		});
	});
});
