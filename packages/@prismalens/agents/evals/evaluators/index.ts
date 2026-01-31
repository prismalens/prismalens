/**
 * Custom Evaluators Index
 *
 * Re-exports all evaluators for easy importing.
 *
 * Evaluator Types:
 * - Rule-based (deterministic, free): hypothesis, recommendation, trajectory
 * - Ground truth comparison (deterministic, free): keyword match, semantic match
 * - LLM-as-Judge (semantic, costs tokens): hypothesis, recommendation, investigation
 * - Unified (combines all): evaluateInvestigationUnified()
 */

// Rule-based evaluators
export * from "./hypothesis.evaluator.js";
export * from "./trajectory.evaluator.js";
export * from "./recommendation.evaluator.js";

// Ground truth comparison
export * from "./ground-truth.evaluator.js";

// LLM-as-Judge evaluator
export * from "./llm-judge.evaluator.js";

// Unified evaluation interface
export * from "./unified.evaluator.js";
