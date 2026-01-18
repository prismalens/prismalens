/**
 * LangSmith Configuration
 *
 * Centralized configuration for LangSmith evaluation and tracking.
 * Used by E2E tests and evaluation experiments.
 */

import { Client } from "langsmith";

// =============================================================================
// CONFIGURATION
// =============================================================================

export const LANGSMITH_CONFIG = {
	/** Project name for all traces */
	projectName: process.env.LANGSMITH_PROJECT || "prismalens-agents-dev",

	/** Dataset names */
	datasets: {
		/** Incident scenarios for E2E testing */
		incidents: "prismalens-incident-scenarios",
		/** Tool trajectory examples */
		trajectories: "prismalens-trajectory-examples",
		/** Hypothesis quality examples */
		hypotheses: "prismalens-hypothesis-examples",
	},

	/** Experiment naming prefix */
	experimentPrefix: "prismalens-eval",

	/** Default evaluation timeout */
	evaluationTimeout: 120000, // 2 minutes
};

// =============================================================================
// CLIENT MANAGEMENT
// =============================================================================

let langsmithClient: Client | null = null;

/**
 * Get or create the LangSmith client
 */
export function getLangSmithClient(): Client | null {
	if (!process.env.LANGSMITH_API_KEY) {
		return null;
	}

	if (!langsmithClient) {
		langsmithClient = new Client({
			apiKey: process.env.LANGSMITH_API_KEY,
		});
	}

	return langsmithClient;
}

/**
 * Initialize LangSmith tracking
 * Call this at the start of E2E test runs
 */
export async function initLangSmith(): Promise<void> {
	const client = getLangSmithClient();
	if (!client) {
		return;
	}

	// Verify API key is valid by making a simple call
	try {
		// This will throw if the API key is invalid
		await client.listProjects({ limit: 1 });
	} catch (error) {
		throw new Error(`Failed to connect to LangSmith: ${error}`);
	}
}

/**
 * Shutdown LangSmith tracking
 * Call this at the end of E2E test runs
 */
export async function shutdownLangSmith(): Promise<void> {
	// Client cleanup if needed
	langsmithClient = null;
}

// =============================================================================
// DATASET MANAGEMENT
// =============================================================================

/**
 * Create or get a dataset by name
 */
export async function getOrCreateDataset(
	name: string,
	description?: string,
): Promise<string> {
	const client = getLangSmithClient();
	if (!client) {
		throw new Error("LangSmith client not initialized");
	}

	// Check if dataset exists
	try {
		const datasets = client.listDatasets({ datasetName: name });
		for await (const dataset of datasets) {
			if (dataset.name === name) {
				return dataset.id;
			}
		}
	} catch {
		// Dataset doesn't exist, create it
	}

	// Create new dataset
	const dataset = await client.createDataset(name, {
		description: description || `Dataset: ${name}`,
	});
	return dataset.id;
}

/**
 * Add an example to a dataset
 */
export async function addDatasetExample(
	datasetId: string,
	inputs: Record<string, unknown>,
	outputs?: Record<string, unknown>,
): Promise<void> {
	const client = getLangSmithClient();
	if (!client) {
		throw new Error("LangSmith client not initialized");
	}

	await client.createExample(inputs, {
		datasetId,
		outputs,
	});
}

// =============================================================================
// EVALUATION HELPERS
// =============================================================================

export interface EvaluationResult {
	score: number;
	comment?: string;
	key: string;
}

/**
 * Log evaluation feedback to a run
 */
export async function logEvaluationFeedback(
	runId: string,
	results: EvaluationResult[],
): Promise<void> {
	const client = getLangSmithClient();
	if (!client) {
		return;
	}

	for (const result of results) {
		await client.createFeedback(runId, result.key, {
			score: result.score,
			comment: result.comment,
		});
	}
}

/**
 * Create a unique experiment name with timestamp
 */
export function createExperimentName(baseName: string): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	return `${LANGSMITH_CONFIG.experimentPrefix}-${baseName}-${timestamp}`;
}

// =============================================================================
// TYPES
// =============================================================================

export interface IncidentScenario {
	id: string;
	name: string;
	category: "code" | "config" | "infrastructure" | "external" | "unknown";
	difficulty: "easy" | "medium" | "hard";
	expectedTools: string[];
	alert: {
		title: string;
		description?: string;
		severity: "critical" | "high" | "medium" | "low" | "info";
	};
	expectedRootCauseCategory: string;
	minimumConfidence: number;
}

export interface TrajectoryExpectation {
	/** Tools that must appear in the trajectory */
	requiredTools: string[];
	/** Tools that must appear in this specific order */
	orderedTools?: string[];
	/** Tools that should NOT appear */
	forbiddenTools?: string[];
	/** Maximum number of tool calls expected */
	maxToolCalls?: number;
}
