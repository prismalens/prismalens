// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Writes the OpenAPI document to dist/openapi.json for anyone who wants a file.
 * Run with: pnpm openapi:generate
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiSpec } from "../src/modules/openapi/build-spec.js";

const outputDir = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"dist",
);

buildOpenApiSpec([
	{ url: "http://localhost:6473/api", description: "Development server" },
	{ url: "/api", description: "Relative path (for proxied deployments)" },
])
	.then((spec) => {
		mkdirSync(outputDir, { recursive: true });
		const jsonPath = resolve(outputDir, "openapi.json");
		writeFileSync(jsonPath, JSON.stringify(spec, null, 2));
		console.log(`OpenAPI spec written to: ${jsonPath}`);
	})
	.catch((error) => {
		console.error("Failed to generate OpenAPI spec:", error);
		process.exit(1);
	});
