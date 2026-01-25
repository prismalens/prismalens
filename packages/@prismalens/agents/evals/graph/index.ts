/**
 * Graph Evaluations Index
 *
 * These tests evaluate the full investigation graph end-to-end.
 */

// Note: Vitest will discover *.eval.ts files automatically.
// This file exists for organizational purposes.

export const graphEvalInfo = {
	description: "Full graph E2E evaluations",
	tests: ["full-investigation.eval.ts"],
	purpose: "Test complete investigation workflow from alert to recommendation",
};
