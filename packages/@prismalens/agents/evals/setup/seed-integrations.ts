/**
 * Seed Test Database with Integration Connections
 *
 * This script seeds test.db with integration connections using credentials
 * from environment variables. These env vars are ONLY used for seeding,
 * not by the application directly.
 *
 * Single Source of Truth: Database stores all credentials.
 */

import type { PrismaClient } from "@prisma/client";

// =============================================================================
// TYPES
// =============================================================================

interface IntegrationDefinition {
	id: string;
	name: string;
}

// =============================================================================
// ENCRYPTION STUB
// =============================================================================

/**
 * Simple encryption for test credentials.
 * In production, use @prismalens/database/encryption.
 * For tests, we use a simple base64 encoding.
 */
function encryptForTest(data: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(data)).toString("base64");
}

// =============================================================================
// SEED FUNCTIONS
// =============================================================================

/**
 * Seed test database with integration connections.
 * Credentials come from CI secrets (environment variables).
 * These env vars are ONLY used for seeding, not by the app directly.
 */
export async function seedTestIntegrations(prisma: PrismaClient): Promise<void> {
	console.log("[Seed] Seeding test integrations...");

	// Get integration definitions
	const definitions = await prisma.integrationDefinition.findMany({
		select: { id: true, name: true },
	});

	const defMap = new Map<string, IntegrationDefinition>(
		definitions.map((d) => [d.name, d]),
	);

	// Seed GitHub integration
	await seedGitHubIntegration(prisma, defMap.get("github"));

	// Seed Render integration
	await seedRenderIntegration(prisma, defMap.get("render"));

	console.log("[Seed] Test integrations seeded successfully");
}

/**
 * Seed GitHub integration if credentials available.
 */
async function seedGitHubIntegration(
	prisma: PrismaClient,
	definition: IntegrationDefinition | undefined,
): Promise<void> {
	if (!definition) {
		console.log("[Seed] GitHub integration definition not found, skipping");
		return;
	}

	const token = process.env.TEST_GITHUB_TOKEN;
	if (!token) {
		console.log("[Seed] TEST_GITHUB_TOKEN not set, skipping GitHub integration");
		return;
	}

	const owner = process.env.TEST_GITHUB_OWNER || "prismalens-org";
	const repo = process.env.TEST_GITHUB_REPO || "prismalens";

	try {
		await prisma.integrationConnection.upsert({
			where: { id: "test-github-connection" },
			create: {
				id: "test-github-connection",
				definitionId: definition.id,
				name: "Test GitHub",
				description: "GitHub integration for evaluations",
				isGlobal: true,
				status: "connected",
				authMethod: "api_key",
				credentials: encryptForTest({ accessToken: token }),
				config: { owner, repo },
			},
			update: {
				credentials: encryptForTest({ accessToken: token }),
				config: { owner, repo },
				status: "connected",
			},
		});
		console.log(`[Seed] GitHub integration seeded: ${owner}/${repo}`);
	} catch (error) {
		console.error("[Seed] Failed to seed GitHub integration:", error);
	}
}

/**
 * Seed Render integration if credentials available.
 */
async function seedRenderIntegration(
	prisma: PrismaClient,
	definition: IntegrationDefinition | undefined,
): Promise<void> {
	if (!definition) {
		console.log("[Seed] Render integration definition not found, skipping");
		return;
	}

	const apiKey = process.env.TEST_RENDER_API_KEY;
	if (!apiKey) {
		console.log("[Seed] TEST_RENDER_API_KEY not set, skipping Render integration");
		return;
	}

	const serviceId = process.env.TEST_RENDER_SERVICE_ID;

	try {
		await prisma.integrationConnection.upsert({
			where: { id: "test-render-connection" },
			create: {
				id: "test-render-connection",
				definitionId: definition.id,
				name: "Test Render",
				description: "Render integration for evaluations",
				isGlobal: true,
				status: "connected",
				authMethod: "api_key",
				credentials: encryptForTest({ apiKey }),
				config: serviceId ? { serviceId } : {},
			},
			update: {
				credentials: encryptForTest({ apiKey }),
				config: serviceId ? { serviceId } : {},
				status: "connected",
			},
		});
		console.log(`[Seed] Render integration seeded: ${serviceId || "no service ID"}`);
	} catch (error) {
		console.error("[Seed] Failed to seed Render integration:", error);
	}
}

// =============================================================================
// CLEANUP
// =============================================================================

/**
 * Clean up test integrations.
 */
export async function cleanupTestIntegrations(prisma: PrismaClient): Promise<void> {
	console.log("[Seed] Cleaning up test integrations...");

	await prisma.integrationConnection.deleteMany({
		where: {
			id: { in: ["test-github-connection", "test-render-connection"] },
		},
	});

	console.log("[Seed] Test integrations cleaned up");
}
