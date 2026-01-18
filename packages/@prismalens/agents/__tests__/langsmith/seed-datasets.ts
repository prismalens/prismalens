#!/usr/bin/env npx tsx
/**
 * LangSmith Dataset Seeding Script
 *
 * Uploads incident investigation scenarios to LangSmith as a dataset.
 * This enables running evaluations against a curated set of test cases.
 *
 * Usage:
 *   export LANGSMITH_API_KEY=your-api-key
 *   npx tsx __tests__/langsmith/seed-datasets.ts
 *
 * Or via npm script:
 *   pnpm eval:seed
 */

import { Client } from "langsmith";
import {
	allScenarios,
	scenarioToTestInput,
	getScenariosByCategory,
	getScenariosByDifficulty,
} from "./datasets/incident-scenarios.js";
import { LANGSMITH_CONFIG } from "../setup/langsmith.config.js";

// =============================================================================
// CONFIGURATION
// =============================================================================

interface SeedOptions {
	/** Only seed specific categories */
	categories?: Array<"code" | "config" | "infrastructure" | "external" | "deployment" | "unknown">;
	/** Only seed specific difficulties */
	difficulties?: Array<"easy" | "medium" | "hard">;
	/** Clear existing examples before seeding */
	clearExisting?: boolean;
	/** Dry run - log what would be done without making changes */
	dryRun?: boolean;
}

// =============================================================================
// SEEDING FUNCTIONS
// =============================================================================

/**
 * Seed LangSmith datasets with incident scenarios
 */
async function seedDatasets(options: SeedOptions = {}): Promise<void> {
	// Check for API key
	if (!process.env.LANGSMITH_API_KEY) {
		console.error("Error: LANGSMITH_API_KEY environment variable is required");
		console.error("\nSet it with: export LANGSMITH_API_KEY=your-api-key");
		process.exit(1);
	}

	const client = new Client({
		apiKey: process.env.LANGSMITH_API_KEY,
	});

	console.log("LangSmith Dataset Seeding");
	console.log("=".repeat(50));
	console.log(`Project: ${LANGSMITH_CONFIG.projectName}`);
	console.log(`Dataset: ${LANGSMITH_CONFIG.datasets.incidents}`);
	if (options.dryRun) {
		console.log("Mode: DRY RUN (no changes will be made)");
	}
	console.log("");

	// Filter scenarios if categories/difficulties specified
	let scenarios = [...allScenarios];

	if (options.categories && options.categories.length > 0) {
		scenarios = scenarios.filter((s) =>
			options.categories!.includes(s.category as typeof options.categories extends Array<infer T> ? T : never),
		);
		console.log(`Filtering by categories: ${options.categories.join(", ")}`);
	}

	if (options.difficulties && options.difficulties.length > 0) {
		scenarios = scenarios.filter((s) =>
			options.difficulties!.includes(s.difficulty),
		);
		console.log(`Filtering by difficulties: ${options.difficulties.join(", ")}`);
	}

	console.log(`Scenarios to seed: ${scenarios.length}`);
	console.log("");

	if (options.dryRun) {
		console.log("Scenarios that would be seeded:");
		for (const scenario of scenarios) {
			console.log(`  - [${scenario.id}] ${scenario.name} (${scenario.category}/${scenario.difficulty})`);
		}
		console.log("\nDry run complete. No changes made.");
		return;
	}

	// Create or get the incidents dataset
	let dataset;
	try {
		const datasets = client.listDatasets({
			datasetName: LANGSMITH_CONFIG.datasets.incidents,
		});
		for await (const d of datasets) {
			if (d.name === LANGSMITH_CONFIG.datasets.incidents) {
				dataset = d;
				break;
			}
		}
	} catch (error) {
		// Dataset doesn't exist, will create below
	}

	if (!dataset) {
		console.log("Creating new dataset...");
		dataset = await client.createDataset(LANGSMITH_CONFIG.datasets.incidents, {
			description:
				"PrismaLens incident investigation scenarios for agent evaluation",
		});
		console.log(`Created dataset: ${dataset.name} (${dataset.id})`);
	} else {
		console.log(`Using existing dataset: ${dataset.name} (${dataset.id})`);

		if (options.clearExisting) {
			console.log("Clearing existing examples...");
			// List and delete existing examples
			const examples = client.listExamples({ datasetId: dataset.id });
			let deleteCount = 0;
			for await (const example of examples) {
				await client.deleteExample(example.id);
				deleteCount++;
			}
			console.log(`Deleted ${deleteCount} existing examples`);
		}
	}

	console.log("");
	console.log("Seeding scenarios...");

	// Add examples from scenarios
	let successCount = 0;
	let errorCount = 0;

	for (const scenario of scenarios) {
		try {
			const input = scenarioToTestInput(scenario);

			await client.createExample(
				// Inputs (what the agent receives)
				{
					investigationId: input.investigationId,
					incidentId: input.incidentId,
					alerts: input.alerts,
					priority: input.priority,
					scenario: {
						id: scenario.id,
						name: scenario.name,
						category: scenario.category,
						difficulty: scenario.difficulty,
					},
				},
				{
					datasetId: dataset.id,
					// Expected outputs (ground truth for evaluation)
					outputs: {
						expectedCategory: scenario.expectedRootCauseCategory,
						minimumConfidence: scenario.minimumConfidence,
						expectedTools: scenario.expectedTools,
					},
				},
			);

			console.log(`  + [${scenario.id}] ${scenario.name}`);
			successCount++;
		} catch (error) {
			console.error(`  x [${scenario.id}] Failed: ${error}`);
			errorCount++;
		}
	}

	console.log("");
	console.log("=".repeat(50));
	console.log(`Seeding complete!`);
	console.log(`  Successful: ${successCount}`);
	console.log(`  Failed: ${errorCount}`);
	console.log("");
	console.log("View your dataset at:");
	console.log(`  https://smith.langchain.com/datasets`);
}

/**
 * Print dataset statistics
 */
async function printDatasetStats(): Promise<void> {
	if (!process.env.LANGSMITH_API_KEY) {
		console.error("Error: LANGSMITH_API_KEY environment variable is required");
		process.exit(1);
	}

	const client = new Client({
		apiKey: process.env.LANGSMITH_API_KEY,
	});

	console.log("Dataset Statistics");
	console.log("=".repeat(50));

	try {
		const datasets = client.listDatasets({
			datasetName: LANGSMITH_CONFIG.datasets.incidents,
		});

		let found = false;
		for await (const dataset of datasets) {
			if (dataset.name === LANGSMITH_CONFIG.datasets.incidents) {
				found = true;
				console.log(`Dataset: ${dataset.name}`);
				console.log(`ID: ${dataset.id}`);
				console.log(`Description: ${dataset.description || "N/A"}`);
				console.log(`Created: ${dataset.created_at}`);

				// Count examples
				const examples = client.listExamples({ datasetId: dataset.id });
				let count = 0;
				const categoryCounts: Record<string, number> = {};
				const difficultyCounts: Record<string, number> = {};

				for await (const example of examples) {
					count++;
					const inputs = example.inputs as Record<string, unknown>;
					const scenario = inputs.scenario as { category?: string; difficulty?: string } | undefined;
					if (scenario?.category) {
						categoryCounts[scenario.category] = (categoryCounts[scenario.category] || 0) + 1;
					}
					if (scenario?.difficulty) {
						difficultyCounts[scenario.difficulty] = (difficultyCounts[scenario.difficulty] || 0) + 1;
					}
				}

				console.log(`\nExamples: ${count}`);

				if (Object.keys(categoryCounts).length > 0) {
					console.log("\nBy Category:");
					for (const [cat, cnt] of Object.entries(categoryCounts)) {
						console.log(`  ${cat}: ${cnt}`);
					}
				}

				if (Object.keys(difficultyCounts).length > 0) {
					console.log("\nBy Difficulty:");
					for (const [diff, cnt] of Object.entries(difficultyCounts)) {
						console.log(`  ${diff}: ${cnt}`);
					}
				}
			}
		}

		if (!found) {
			console.log("Dataset not found. Run seed first to create it.");
		}
	} catch (error) {
		console.error("Error fetching dataset stats:", error);
	}
}

// =============================================================================
// CLI
// =============================================================================

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`
LangSmith Dataset Seeding Script

Usage:
  npx tsx seed-datasets.ts [options]

Options:
  --dry-run       Show what would be seeded without making changes
  --clear         Clear existing examples before seeding
  --stats         Show dataset statistics
  --category=X    Only seed scenarios of category X (code, config, infrastructure, external, deployment, unknown)
  --difficulty=X  Only seed scenarios of difficulty X (easy, medium, hard)
  --help, -h      Show this help message

Examples:
  # Seed all scenarios
  npx tsx seed-datasets.ts

  # Seed only code bug scenarios
  npx tsx seed-datasets.ts --category=code

  # Seed easy scenarios and clear existing
  npx tsx seed-datasets.ts --difficulty=easy --clear

  # Dry run to see what would be seeded
  npx tsx seed-datasets.ts --dry-run
`);
		return;
	}

	if (args.includes("--stats")) {
		await printDatasetStats();
		return;
	}

	const options: SeedOptions = {
		dryRun: args.includes("--dry-run"),
		clearExisting: args.includes("--clear"),
	};

	// Parse category filter
	const categoryArg = args.find((a) => a.startsWith("--category="));
	if (categoryArg) {
		const category = categoryArg.split("=")[1];
		options.categories = [category as "code" | "config" | "infrastructure" | "external" | "deployment" | "unknown"];
	}

	// Parse difficulty filter
	const difficultyArg = args.find((a) => a.startsWith("--difficulty="));
	if (difficultyArg) {
		const difficulty = difficultyArg.split("=")[1];
		options.difficulties = [difficulty as "easy" | "medium" | "hard"];
	}

	await seedDatasets(options);
}

// Run if executed directly
main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
