// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { OpenAPIGenerator } from "@orpc/openapi";
// zod4 subpath required: the root "@orpc/zod" export targets zod v3 and silently
// no-ops on this repo's zod v4 schemas (#547).
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { contract } from "@prismalens/contracts";

export interface OpenApiServer {
	url: string;
	description: string;
}

export type OpenApiSpec = Awaited<ReturnType<OpenAPIGenerator["generate"]>>;

/**
 * The API's OpenAPI document, built from the oRPC contract. The spec is generated,
 * never committed: the server builds it at runtime and a test runs this (#547, #1024).
 */
export function buildOpenApiSpec(
	servers: OpenApiServer[],
): Promise<OpenApiSpec> {
	const generator = new OpenAPIGenerator({
		schemaConverters: [new ZodToJsonSchemaConverter()],
	});
	return generator.generate(contract, {
		info: {
			title: "PrismaLens API",
			version: "1.0.0",
			description: "PrismaLens API - incident investigation",
			contact: {
				name: "PrismaLens Team",
				url: "https://github.com/prismalens-org/prismalens",
			},
			license: {
				name: "Apache-2.0",
				url: "https://www.apache.org/licenses/LICENSE-2.0",
			},
		},
		servers,
		tags: [
			{ name: "alerts", description: "Alert management" },
			{ name: "incidents", description: "Incident management" },
			{ name: "investigations", description: "AI-powered investigations" },
			{ name: "recommendations", description: "Recommendations management" },
			{ name: "services", description: "Service catalog management" },
			{ name: "webhooks", description: "Webhook ingestion endpoints" },
			{ name: "events", description: "Event management" },
			{ name: "timeline", description: "Incident timeline entries" },
			{ name: "integrations", description: "External integrations" },
			{
				name: "threads",
				description: "Project, service and no-subject threads",
			},
			{ name: "drafts", description: "Composer drafts" },
			{ name: "references", description: "What a message can do or refer to" },
		],
	});
}
