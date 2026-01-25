/**
 * Component Evaluations Index
 *
 * These tests evaluate individual subagents in isolation.
 */

// Note: Vitest will discover *.eval.ts files automatically.
// This file exists for organizational purposes.

export const componentEvalInfo = {
	description: "Subagent component evaluations",
	tests: ["detective.eval.ts", "surgeon.eval.ts"],
	purpose: "Test individual agents without full graph execution",
};
