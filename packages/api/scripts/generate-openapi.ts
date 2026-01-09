/**
 * OpenAPI Specification Generator
 *
 * Generates OpenAPI 3.1 specification from oRPC contracts.
 * Run with: pnpm openapi:generate
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { contract } from "@prismalens/contracts";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function generateOpenAPISpec() {
	console.log("Generating OpenAPI specification...");

	const generator = new OpenAPIGenerator({
		schemaConverters: [new ZodToJsonSchemaConverter()],
	});

	const spec = await generator.generate(contract, {
		info: {
			title: "PrismaLens API",
			version: "1.0.0",
			description:
				"PrismaLens Community Edition API - Incident management and root cause analysis platform",
			contact: {
				name: "PrismaLens Team",
				url: "https://github.com/prismalens-org/prismalens",
			},
			license: {
				name: "ELv2",
				url: "https://www.elastic.co/licensing/elastic-license",
			},
		},
		servers: [
			{
				url: "http://localhost:3001/api",
				description: "Development server",
			},
			{
				url: "/api",
				description: "Relative path (for proxied deployments)",
			},
		],
		tags: [
			{ name: "alerts", description: "Alert management" },
			{ name: "incidents", description: "Incident management" },
			{ name: "investigations", description: "AI-powered investigations" },
			{ name: "recommendations", description: "Recommendations management" },
			{ name: "services", description: "Service catalog management" },
			{ name: "webhooks", description: "Webhook ingestion endpoints" },
			{ name: "events", description: "Event management" },
			{ name: "timeline", description: "Incident timeline entries" },
			{ name: "correlation", description: "Alert correlation rules" },
			{ name: "integrations", description: "External integrations" },
			{
				name: "service-discovery",
				description: "Service discovery suggestions",
			},
			{ name: "alert-mapping", description: "Alert to service mapping rules" },
		],
	});

	// Output paths
	const outputDir = resolve(__dirname, "..");
	const jsonPath = resolve(outputDir, "openapi.json");

	// Write JSON spec
	writeFileSync(jsonPath, JSON.stringify(spec, null, 2));
	console.log(`OpenAPI spec written to: ${jsonPath}`);

	console.log("\nGeneration complete!");
	console.log(`  - JSON: ${jsonPath}`);
}

generateOpenAPISpec().catch((error) => {
	console.error("Failed to generate OpenAPI spec:", error);
	process.exit(1);
});
