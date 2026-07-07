// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";

/**
 * LangSmith/LangChain tracing configuration.
 * Used for agent observability and debugging with LangSmith Studio.
 */
export const langsmithSchema = z.object({
	/** LangSmith API key for tracing (optional - tracing disabled if not set) */
	LANGSMITH_API_KEY: z.string().optional().describe("LangSmith API key"),

	/** Enable LangSmith tracing */
	LANGSMITH_TRACING: z
		.string()
		.transform((v) => v === "true")
		.default("false")
		.describe("Enable LangSmith tracing"),

	/** LangChain tracing v2 flag (mirrors LANGSMITH_TRACING) */
	LANGCHAIN_TRACING_V2: z
		.string()
		.transform((v) => v === "true")
		.default("false")
		.describe("Enable LangChain tracing v2"),

	/** LangSmith project name for traces */
	LANGCHAIN_PROJECT: z
		.string()
		.default("prismalens-agents-dev")
		.describe("LangSmith project name"),
});

export type LangsmithConfig = z.infer<typeof langsmithSchema>;
