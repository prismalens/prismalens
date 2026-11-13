// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Sub-agents an agent starts inside its own session, and the secrets a run asks
 * the user for (#1025, spec B on #1024).
 */
import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";

/** Body of `POST /investigations/{id}/subagents/{sessionId}/cancel`. */
export const CancelSubagentSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		sessionId: z.string().min(1).max(200),
	}),
);
export type CancelSubagentInput = z.infer<typeof CancelSubagentSchema>;

export const CancelSubagentResultSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		state: z.literal("cancelling"),
	}),
);
export type CancelSubagentResult = z.infer<typeof CancelSubagentResultSchema>;

/** A requested secret's variable name: what the agent is told, never the value. */
export const SECRET_ENV_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
export const SECRET_VALUE_MAX = 16 * 1024;

/** Body of `POST /investigations/{id}/secrets/{requestId}`: write-only, host-only. */
export const AnswerSecretSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		requestId: z.string().uuid(),
		value: z.string().min(1).max(SECRET_VALUE_MAX),
	}),
);
export type AnswerSecretInput = z.infer<typeof AnswerSecretSchema>;

/** Carries no value back: the ask closes `answered`, and that is all anyone learns. */
export const AnswerSecretResultSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		outcome: z.literal("answered"),
	}),
);
export type AnswerSecretResult = z.infer<typeof AnswerSecretResultSchema>;

/** Settings → Agent → Advanced: unset is "Agent's default", which sets nothing. */
export const SubagentLimitSchema = /* @__PURE__ */ lazySchema(() =>
	z.number().int().min(1).max(8),
);

/** In-session sub-agents on a stopped turn: stop with it, or finish (#1101 cat 10). */
export const SubagentsOnStopSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(["stop", "finish"]),
);
export type SubagentsOnStop = z.infer<typeof SubagentsOnStopSchema>;
