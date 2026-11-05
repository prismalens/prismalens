// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HARNESS_IDS } from "@prismalens/config/harness";
/**
 * What the composer holds before it is sent (#1024): text, attachments, quotes,
 * references and the run choices, kept as one server-side draft per scope.
 */
import { z } from "zod";
import { AccessLevelSchema } from "./settings.js";

const UUID =
	"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/** `thread:<id>`, `new:home`, or `new:project|service|incident:<id>`. */
export const ComposerScopeSchema = z
	.string()
	.regex(
		new RegExp(
			`^(thread:${UUID}|new:home|new:(project|service|incident):${UUID})$`,
		),
		"Not a composer scope.",
	);
export type ComposerScope = z.infer<typeof ComposerScopeSchema>;

/** The thread a `thread:<id>` scope names, else null. */
export function scopeThreadId(scope: string): string | null {
	return scope.startsWith("thread:") ? scope.slice("thread:".length) : null;
}

export const QUOTE_MAX_CHARS = 8000;

export const QuoteSchema = z.object({
	source: z.object({
		threadId: z.string().uuid(),
		/** The event the text came from, so the chip scrolls back to it. */
		seq: z.number().int().min(0).optional(),
		kind: z.enum(["transcript", "report", "tool_output"]),
	}),
	text: z.string().min(1).max(QUOTE_MAX_CHARS),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const REFERENCE_KINDS = [
	"file",
	"folder",
	"service",
	"project",
	"attachment",
	"artifact",
	"runbook",
	"thread",
	"incident",
	"schedule",
	"pull_request",
	"command",
] as const;
export const ReferenceKindSchema = z.enum(REFERENCE_KINDS);
export type ReferenceKind = z.infer<typeof ReferenceKindSchema>;

export const ReferenceRefSchema = z.object({
	kind: ReferenceKindSchema,
	/** A record id, a workspace-relative path, or a command name. */
	id: z.string().min(1).max(1024),
	label: z.string().min(1).max(200),
});
export type ReferenceRef = z.infer<typeof ReferenceRefSchema>;

export const MAX_QUOTES_PER_MESSAGE = 10;
export const MAX_REFERENCES_PER_MESSAGE = 20;

/** What a message carries beside its text: shared by every send body. */
export const MessageContextShape = {
	quotes: z.array(QuoteSchema).max(MAX_QUOTES_PER_MESSAGE).optional(),
	references: z
		.array(ReferenceRefSchema)
		.max(MAX_REFERENCES_PER_MESSAGE)
		.optional(),
	/** The draft this send came from: deleted in the same transaction when `draftRev` is current. */
	draftScope: ComposerScopeSchema.optional(),
	draftRev: z.number().int().min(0).optional(),
};

/** Bound on the agent-facing text a message's quotes and references add. */
export const MESSAGE_ADDENDUM_MAX_CHARS = 100_000;

/**
 * What a message carries to the run beside its text: the quotes and references the
 * transcript shows, and `addendum`, the text the agent receives after the message.
 */
export const JobMessageContextSchema = z.object({
	quotes: z.array(QuoteSchema).optional(),
	references: z.array(ReferenceRefSchema).optional(),
	addendum: z.string().max(MESSAGE_ADDENDUM_MAX_CHARS).optional(),
});
export type JobMessageContext = z.infer<typeof JobMessageContextSchema>;

export const DraftChoiceSchema = z.object({
	harness: z.enum(HARNESS_IDS).optional(),
	model: z.string().min(1).max(256).nullable().optional(),
	effort: z.string().min(1).max(64).nullable().optional(),
	accessLevel: AccessLevelSchema.optional(),
	verb: z.enum(["investigate", "ask"]).optional(),
	/** The new thread's Incident toggle. */
	incident: z.boolean().optional(),
});
export type DraftChoice = z.infer<typeof DraftChoiceSchema>;

/** Above the 4000 a send takes, so a long draft is kept while the user trims it. */
export const DRAFT_TEXT_MAX_CHARS = 16000;

/** The draft's editable body: what `PUT /drafts/{scope}` stores. */
export const DraftBodySchema = z.object({
	text: z.string().max(DRAFT_TEXT_MAX_CHARS),
	/** The key its attachments were uploaded under. */
	draftKey: z.string().uuid().nullable(),
	attachments: z.array(z.string().uuid()).max(10),
	quotes: z.array(QuoteSchema).max(MAX_QUOTES_PER_MESSAGE),
	references: z.array(ReferenceRefSchema).max(MAX_REFERENCES_PER_MESSAGE),
	choice: DraftChoiceSchema,
});
export type DraftBody = z.infer<typeof DraftBodySchema>;

export const ComposerDraftSchema = DraftBodySchema.extend({
	scope: ComposerScopeSchema,
	/** Bumped on every save; a write against an older rev gets 409. */
	rev: z.number().int().min(0),
	/** Bumped when the draft is sent; an autosave from before the send gets 409. */
	generation: z.number().int().min(0),
	updatedAt: z.string().datetime(),
});
export type ComposerDraft = z.infer<typeof ComposerDraftSchema>;

export const DraftScopeParamSchema = z.object({ scope: ComposerScopeSchema });

/** Body of `PUT /drafts/{scope}`: the body plus the rev and generation it was edited from. */
export const PutDraftSchema = DraftBodySchema.extend({
	scope: ComposerScopeSchema,
	/** The rev this edit started from; 0 for a draft not saved yet. */
	baseRev: z.number().int().min(0),
	generation: z.number().int().min(0),
});
export type PutDraftInput = z.infer<typeof PutDraftSchema>;

/** Drafts untouched this long, and their attachments, are swept at boot. */
export const DRAFT_SWEEP_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** A paste past either bound becomes a text attachment (Settings → General). */
export const PASTE_FOLD_MIN_CHARS = 2000;
export const PASTE_FOLD_MIN_LINES = 40;

/** Whether a paste folds into a text attachment (pure, so every client agrees). */
export function shouldFoldPaste(text: string): boolean {
	if (text.length > PASTE_FOLD_MIN_CHARS) return true;
	let lines = 1;
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10 && ++lines > PASTE_FOLD_MIN_LINES)
			return true;
	}
	return false;
}

/** A quote as the agent receives it: a Markdown blockquote with a source line. */
export function quoteMarkdown(quote: Quote, sourceLabel: string): string {
	const body = quote.text
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
	return `${body}\n> — ${sourceLabel}`;
}
