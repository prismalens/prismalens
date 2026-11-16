// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One pending-ask shape for permission, question, input and secret asks, from the
 * agent, a sub-agent or a PrismaLens tool (#1024). Imports nothing from
 * investigation.ts, which builds its `ask_opened` / `ask_closed` events from it.
 */
import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";

/**
 * How a legacy permission ask ended (#673 w21): the operator answered, nobody
 * did in time, the run stopped, or PrismaLens restarted; or the run's level
 * answered it: `allowed`, or an agent's own mode switch refused (`mode_kept`).
 */
export const PERMISSION_ASK_OUTCOMES = [
	"approved",
	"denied",
	"timed_out",
	"stopped",
	"restarted",
	"allowed",
	"mode_kept",
	// An alert-started run refused it: nobody was there to answer (#818 w5-29).
	"unattended",
] as const;
export type PermissionAskOutcome = (typeof PERMISSION_ASK_OUTCOMES)[number];

/** `ask_closed` outcomes: the permission ones plus how a question or input ended. */
export const ASK_CLOSED_OUTCOMES = [
	...PERMISSION_ASK_OUTCOMES,
	"answered",
	"declined",
	"expired",
] as const;
export type AskClosedOutcome = (typeof ASK_CLOSED_OUTCOMES)[number];

export const ASK_KINDS = ["permission", "question", "input", "secret"] as const;
export const AskKindSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(ASK_KINDS),
);
export type AskKind = z.infer<typeof AskKindSchema>;

/** Questions wait this long by default before they are declined (Settings → Agent). */
export const QUESTION_ASK_TIMEOUT_MS = 30 * 60 * 1000;

/** The stored "Questions from agents wait for" minutes as ms; undefined for anything unusable. */
export function questionTimeoutFrom(
	raw: string | undefined,
): number | undefined {
	let minutes: unknown;
	try {
		minutes = raw === undefined ? undefined : JSON.parse(raw);
	} catch {
		return undefined;
	}
	return typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
		? Math.min(minutes, 24 * 60) * 60_000
		: undefined;
}

export const AskSourceSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("agent") }),
		z.object({
			kind: z.literal("subagent"),
			sessionId: z.string().min(1).max(200),
			title: z.string().max(200),
		}),
		z.object({
			kind: z.literal("tool"),
			tool: z.string().min(1).max(100),
			requestId: z.string().min(1).max(200),
		}),
	]),
);
export type AskSource = z.infer<typeof AskSourceSchema>;

/** ACP's permission option, as the agent offered it. */
export const AskPermissionOptionSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		optionId: z.string().min(1).max(200),
		name: z.string().max(200),
		kind: z.enum([
			"allow_once",
			"allow_always",
			"reject_once",
			"reject_always",
		]),
	}),
);
export type AskPermissionOption = z.infer<typeof AskPermissionOptionSchema>;

export const AskPermissionSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		toolKind: z.string().nullable(),
		/** A mode-switch ask out of plan mode: "Plan ready: Approve / Keep planning". */
		variant: z.literal("plan").optional(),
		command: z.string().optional(),
		/** The call's input as JSON when it names no command or path. */
		input: z.string().optional(),
		/** What Always allow will match, shown on its button. */
		pattern: z.string().optional(),
		/** Empty on legacy asks: the dock offers Allow once, Deny. */
		options: z.array(AskPermissionOptionSchema).max(8),
		toolCallId: z.string().optional(),
		server: z.string().optional(),
		/** A hash of what the call would do, for Always allow (#1020). */
		identity: z.string().optional(),
	}),
);
export type AskPermission = z.infer<typeof AskPermissionSchema>;

export const AskQuestionOptionSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().min(1).max(100),
		label: z.string().min(1).max(200),
		description: z.string().max(1000).optional(),
		/** Shown in a preview pane when the option is focused. */
		preview: z.string().max(8000).optional(),
	}),
);

export const AskQuestionSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().min(1).max(100),
		prompt: z.string().min(1).max(2000),
		header: z.string().max(40).optional(),
		multiSelect: z.boolean(),
		/** Adds an "Other" option with free text. */
		allowOther: z.boolean(),
		/** The form requires an answer to it; absent on an ask from before #1024. */
		required: z.boolean().optional(),
		options: z.array(AskQuestionOptionSchema).min(2).max(4),
	}),
);
export type AskQuestion = z.infer<typeof AskQuestionSchema>;

/**
 * The restricted form schema of an ACP form-mode elicitation: a flat object of
 * primitive fields (string, number, integer, boolean, string enum).
 */
const ElicitFieldBase = {
	title: z.string().max(200).optional(),
	description: z.string().max(1000).optional(),
};
export const ElicitFieldSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("type", [
		z.object({
			type: z.literal("string"),
			...ElicitFieldBase,
			minLength: z.number().int().min(0).optional(),
			maxLength: z.number().int().min(0).optional(),
			format: z.enum(["email", "uri", "date", "date-time"]).optional(),
			enum: z.array(z.string().max(200)).min(1).max(50).optional(),
			enumNames: z.array(z.string().max(200)).max(50).optional(),
			default: z.string().optional(),
		}),
		z.object({
			type: z.enum(["number", "integer"]),
			...ElicitFieldBase,
			minimum: z.number().optional(),
			maximum: z.number().optional(),
			default: z.number().optional(),
		}),
		z.object({
			type: z.literal("boolean"),
			...ElicitFieldBase,
			default: z.boolean().optional(),
		}),
	]),
);
export type ElicitField = z.infer<typeof ElicitFieldSchema>;

export const ElicitFormSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		type: z.literal("object"),
		properties: z
			.record(z.string().min(1).max(100), ElicitFieldSchema)
			.refine((p) => Object.keys(p).length <= 30, "At most 30 fields."),
		required: z.array(z.string()).optional(),
	}),
);
export type ElicitForm = z.infer<typeof ElicitFormSchema>;

export const PendingAskSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		askId: z.string().uuid(),
		threadId: z.string().uuid(),
		kind: AskKindSchema,
		/** Only the host's own session (`admin:access`) may answer (ADR 0004 §6). */
		requiresHost: z.boolean(),
		source: AskSourceSchema,
		title: z.string().max(500),
		detail: z.string().nullable().optional(),
		openedAt: z.string().datetime(),
		expiresAt: z.string().datetime().optional(),
		permission: AskPermissionSchema.optional(),
		questions: z.array(AskQuestionSchema).min(1).max(4).optional(),
		input: z.object({ schema: ElicitFormSchema }).optional(),
	}),
);
export type PendingAsk = z.infer<typeof PendingAskSchema>;

export const AskValueSchema = /* @__PURE__ */ lazySchema(() =>
	z.union([z.string(), z.number(), z.boolean()]),
);

/** An answer to one ask. A `secret` ask has no variant: surface B answers it write-only. */
export const AskAnswerSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("permission"),
			decision: z.enum(["approve", "deny"]),
			/** `tree` only answers a `source.kind = "tool"` ask, and needs the host. */
			scope: z.enum(["once", "always", "tree"]).optional(),
			/** Queued to the session as a message straight after the rejection. */
			reason: z.string().trim().min(1).max(2000).optional(),
		}),
		z.object({
			kind: z.literal("question"),
			answers: z.record(
				z.string().min(1).max(100),
				z.object({
					options: z.array(z.string().min(1).max(100)).max(4),
					other: z.string().trim().max(2000).optional(),
				}),
			),
		}),
		z.object({
			kind: z.literal("input"),
			values: z.record(z.string().min(1).max(100), AskValueSchema),
		}),
		z.object({ kind: z.literal("decline") }),
	]),
);
export type AskAnswer = z.infer<typeof AskAnswerSchema>;

/**
 * Body of `POST /investigations/{id}/asks/{askId}`: `answer`, or the legacy
 * `{ decision, always? }` body, which still parses as a permission answer.
 */
export const AnswerAskSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		askId: z.string().uuid(),
		answer: AskAnswerSchema.optional(),
		decision: z.enum(["approve", "deny"]).optional(),
		/** With approve on a scheduled run: its next runs allow this exact ask (#1020). Host only. */
		always: z.boolean().optional(),
	}),
);
export type AnswerAskInput = z.infer<typeof AnswerAskSchema>;

/** The answer an `AnswerAskInput` carries, the legacy body mapped onto `permission`; null when it has neither. */
export function toAskAnswer(input: {
	answer?: AskAnswer;
	decision?: "approve" | "deny";
	always?: boolean;
}): AskAnswer | null {
	if (input.answer) return input.answer;
	if (!input.decision) return null;
	return {
		kind: "permission",
		decision: input.decision,
		...(input.always ? { scope: "always" as const } : {}),
	};
}

export const AnswerAskResultSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		outcome: z.enum(["approved", "denied", "answered", "declined"]),
	}),
);
export type AnswerAskResult = z.infer<typeof AnswerAskResultSchema>;

/** Whether this answer must come from the host's own session (ADR 0004 §6). */
export function answerRequiresHost(
	ask: Pick<PendingAsk, "requiresHost">,
	answer: AskAnswer,
): boolean {
	return (
		ask.requiresHost ||
		(answer.kind === "permission" && answer.scope === "tree")
	);
}
