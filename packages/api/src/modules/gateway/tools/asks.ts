// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type AskQuestion, SECRET_ENV_NAME } from "@prismalens/contracts";
import {
	defineHarnessTool,
	fail,
	type HarnessTool,
	registered,
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { ANYWHERE } from "./serves.js";

/**
 * The composer's ask dock answers a tool's question or secret ask (#1024), so runs
 * are offered these tools. A test may turn it off to check a run without them.
 */
export const ASK_DOCK = { shipped: true };

/** The investigations module's ToolAsksService, reached lazily: it depends on dispatch, which depends on the gateway. */
export const TOOL_ASKS = Symbol("TOOL_ASKS");

/** What the ask tools open; the api holds each ask in surface A's AsksService. */
export interface AsksData {
	question(
		runId: string,
		questions: AskQuestion[],
	): Promise<{ askId: string } | { error: string }>;
	secret(
		runId: string,
		input: { name: string; reason: string },
	): Promise<{ requestId: string; name: string } | { error: string }>;
}

/**
 * Agents whose own question tool already reaches the user through ACP elicitation:
 * claude-agent-acp 0.99.1 routes AskUserQuestion there (acp-agent.js:7994) and
 * codex-acp 2.5.0 its request_user_input (dist/index.js:39060).
 */
export const ELICITING_AGENTS = ["claude-code", "codex"] as const;

const PREVIEW_MAX = 4_000;

const option = z.object({
	label: z.string().trim().min(1).max(200),
	description: z.string().trim().max(1_000).optional(),
	preview: z.string().max(PREVIEW_MAX).optional(),
});

const question = z.object({
	question: z.string().trim().min(1).max(2_000),
	header: z.string().trim().max(40).optional(),
	multiSelect: z.boolean().default(false),
	options: z.array(option).min(2).max(4),
});

/** The tool's questions as surface A's question ask: ids by position, an Other on each. */
export function askQuestions(
	input: z.output<typeof question>[],
): AskQuestion[] {
	return input.map((q, i) => ({
		id: `q${i + 1}`,
		prompt: q.question,
		...(q.header ? { header: q.header } : {}),
		multiSelect: q.multiSelect,
		allowOther: true,
		required: true,
		options: q.options.map((o, j) => ({
			id: `o${j + 1}`,
			label: o.label,
			...(o.description ? { description: o.description } : {}),
			...(o.preview ? { preview: o.preview } : {}),
		})),
	}));
}

/** The user's own answers, asked for by the agent; never in search, never for an unwatched run (#1024 spec B). */
export function askTools(data: AsksData): HarnessTool[] {
	const base = {
		group: "core",
	} as const;
	return [
		defineHarnessTool({
			...base,
			...registered("pl_ask_user"),
			serves: {
				...ANYWHERE,
				attended: true,
				dock: true,
				notFor: ELICITING_AGENTS,
			},
			input: z.object({ questions: z.array(question).min(1).max(4) }),
			run: async ({ questions }, ctx) => {
				const r = await data.question(ctx.runId, askQuestions(questions));
				if ("error" in r)
					return fail(
						"run_ended",
						r.error,
						"Decide without the user's answer.",
					);
				return {
					value: {
						askId: r.askId,
						status: "asked",
						note: "The answer arrives as a message from the user.",
					},
				};
			},
		}),
		defineHarnessTool({
			...base,
			...registered("pl_secret_request"),
			serves: { ...ANYWHERE, attended: true, dock: true },
			input: z.object({
				name: z.string().trim().regex(SECRET_ENV_NAME),
				reason: z.string().trim().min(1).max(500),
			}),
			run: async (input, ctx) => {
				const r = await data.secret(ctx.runId, input);
				if ("error" in r)
					return fail(
						"invalid_input",
						r.error,
						"Call again with another variable name, or carry on without it.",
					);
				return {
					value: {
						requestId: r.requestId,
						env: r.name,
						status: "asked",
						note: `End your turn. The value will be in $${r.name} when the session opens again.`,
					},
				};
			},
		}),
	];
}
