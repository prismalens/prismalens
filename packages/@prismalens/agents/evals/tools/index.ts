/**
 * Tool Evaluations Index
 *
 * These tests evaluate individual tools in isolation.
 */

// Note: Vitest will discover *.eval.ts files automatically.
// This file exists for organizational purposes.

export const toolEvalInfo = {
	description: "Individual tool evaluations",
	tests: ["hypothesis.eval.ts", "fix-proposal.eval.ts"],
	purpose: "Test tool schemas, validation, and quality metrics",
};
