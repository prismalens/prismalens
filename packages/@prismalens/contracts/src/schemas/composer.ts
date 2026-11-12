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
	"issue",
	"alert",
	"silence",
	"alert_rule",
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

/** A folded paste keeps its text in the document, so a second device can expand it. */
export const DRAFT_PASTE_MAX_CHARS = 100_000;
export const DRAFT_DOC_MAX_CHIPS = 60;
export const DRAFT_DOC_MAX_BLOCKS = 400;

const nullableText = (max: number) => z.string().max(max).nullable().optional();

/** One inline chip in the composer's document (#1101 category 7). */
export const ChipAttrsSchema = z.discriminatedUnion("chip", [
	z.object({
		chip: z.literal("ref"),
		ref: ReferenceRefSchema,
		/** A pasted link: Backspace turns the chip back into this text. */
		url: nullableText(2048),
		tone: nullableText(64),
	}),
	z.object({
		chip: z.literal("command"),
		name: z.string().min(1).max(200),
		source: z.enum(["app", "agent"]),
		group: z.string().max(120),
		inputHint: nullableText(200),
	}),
	z.object({
		chip: z.literal("quote"),
		quote: QuoteSchema,
		cut: z.boolean(),
	}),
	z.object({
		chip: z.literal("file"),
		/** The browser's key for the bytes it keeps until the send. */
		key: z.string().min(1).max(200),
		name: z.string().max(255),
		type: z.string().max(255),
		size: z.number().int().min(0),
		pasted: nullableText(DRAFT_PASTE_MAX_CHARS),
		refusal: nullableText(300),
	}),
]);
export type ChipAttrs = z.infer<typeof ChipAttrsSchema>;

const TextNodeSchema = z.object({
	type: z.literal("text"),
	text: z.string().min(1).max(DRAFT_TEXT_MAX_CHARS),
});
const ChipNodeSchema = z.object({
	type: z.literal("chip"),
	attrs: ChipAttrsSchema,
});
const InlineNodeSchema = z.discriminatedUnion("type", [
	TextNodeSchema,
	ChipNodeSchema,
	z.object({ type: z.literal("hardBreak") }),
]);
export type ComposerInline = z.infer<typeof InlineNodeSchema>;

/**
 * The composer's editor document, version 2 of the draft (#1101): paragraphs of text
 * with chip nodes inline where they were picked, files by key. It is the editor's own
 * JSON, so a draft loads into the editor without a conversion step.
 */
export const ComposerDocSchema = z
	.object({
		type: z.literal("doc"),
		content: z
			.array(
				z.object({
					type: z.literal("paragraph"),
					content: z.array(InlineNodeSchema).max(2000).optional(),
				}),
			)
			.min(1)
			.max(DRAFT_DOC_MAX_BLOCKS),
	})
	.superRefine((doc, ctx) => {
		let chips = 0;
		let chars = 0;
		for (const p of doc.content)
			for (const n of p.content ?? []) {
				if (n.type === "chip") chips++;
				if (n.type === "text") chars += n.text.length;
			}
		if (chips > DRAFT_DOC_MAX_CHIPS)
			ctx.addIssue({ code: "custom", message: "Too many chips in one draft." });
		if (chars > DRAFT_TEXT_MAX_CHARS)
			ctx.addIssue({
				code: "custom",
				message: "The draft's text is too long.",
			});
	});
export type ComposerDoc = z.infer<typeof ComposerDocSchema>;

/** The draft's editable body: what `PUT /drafts/{scope}` stores. */
export const DraftBodySchema = z.object({
	/** 2 when `doc` is the source of truth; a body without it is a legacy draft. */
	version: z.literal(2).optional(),
	doc: ComposerDocSchema.optional(),
	text: z.string().max(DRAFT_TEXT_MAX_CHARS),
	/** The key its attachments were uploaded under. */
	draftKey: z.string().uuid().nullable(),
	attachments: z.array(z.string().uuid()).max(10),
	/** Which of `attachments` began as a long paste, so a restored chip expands and pastes back. */
	foldedPastes: z.array(z.string().uuid()).max(10).optional(),
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

/** One file the draft holds, as a fresh browser rebuilds its chip. */
export const DraftAttachmentSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	mimeType: z.string(),
	size: z.number().int().min(0),
	/** It began as a long paste: the chip expands it and offers Paste as text. */
	foldedPaste: z.boolean(),
});
export type DraftAttachment = z.infer<typeof DraftAttachmentSchema>;

export const DraftAttachmentParamSchema = z.object({
	scope: ComposerScopeSchema,
	id: z.string().uuid(),
});

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
