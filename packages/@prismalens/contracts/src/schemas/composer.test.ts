// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	ComposerDraftSchema,
	ComposerScopeSchema,
	PutDraftSchema,
	messageRefId,
	QuoteSchema,
	quoteMarkdown,
	scopeThreadId,
	shouldFoldPaste,
} from "./composer.js";
import { parseMessageRefId } from "./composer-values.js";
import {
	ReferenceSearchInputSchema,
	referenceKey,
	referenceNumber,
	TRIGGER_KINDS,
} from "./references.js";
import { StartThreadSchema } from "./thread.js";

const ID = "6a3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("composer scopes and drafts (#1024)", () => {
	it("accepts the five scopes and nothing else", () => {
		for (const ok of [
			`thread:${ID}`,
			"new:home",
			`new:project:${ID}`,
			`new:service:${ID}`,
			`new:incident:${ID}`,
		])
			expect(ComposerScopeSchema.safeParse(ok).success).toBe(true);
		for (const bad of ["thread:x", "new:schedule:" + ID, "home", `thread:${ID}/x`])
			expect(ComposerScopeSchema.safeParse(bad).success).toBe(false);
		expect(scopeThreadId(`thread:${ID}`)).toBe(ID);
		expect(scopeThreadId("new:home")).toBeNull();
	});

	it("a draft round-trips with its choices; a save names its base rev and generation", () => {
		const draft = {
			scope: `thread:${ID}`,
			rev: 3,
			generation: 1,
			text: "why is p99 up?",
			draftKey: ID,
			attachments: [ID],
			quotes: [{ source: { threadId: ID, seq: 4, kind: "report" }, text: "pool exhausted" }],
			references: [{ kind: "file", id: "src/db.ts", label: "db.ts" }],
			choice: { harness: "claude-code", model: null, verb: "ask", incident: false },
			updatedAt: "2026-11-07T10:00:00.000Z",
		};
		expect(ComposerDraftSchema.parse(draft)).toEqual(draft);
		const { rev: _r, updatedAt: _u, ...body } = draft;
		expect(PutDraftSchema.safeParse({ ...body, baseRev: 3 }).success).toBe(true);
		expect(PutDraftSchema.safeParse(body).success).toBe(false);
	});

	it("a send carries quotes, references and the draft it came from", () => {
		const parsed = StartThreadSchema.parse({
			subject: { kind: "none" },
			text: "look",
			quotes: [{ source: { threadId: ID, kind: "transcript" }, text: "x" }],
			references: [{ kind: "thread", id: ID, label: "Earlier" }],
			draftScope: "new:home",
			draftRev: 2,
		});
		expect(parsed.draftScope).toBe("new:home");
		expect(parsed.references).toHaveLength(1);
	});

	it("a quote is at most 8,000 characters and reaches the agent as a blockquote with its source", () => {
		expect(
			QuoteSchema.safeParse({
				source: { threadId: ID, kind: "transcript" },
				text: "x".repeat(8001),
			}).success,
		).toBe(false);
		expect(
			quoteMarkdown(
				{ source: { threadId: ID, kind: "report" }, text: "a\nb" },
				'from the report of thread "Pool"',
			),
		).toBe('> a\n> b\n> — from the report of thread "Pool"');
		expect(
			quoteMarkdown(
				{
					source: {
						threadId: ID,
						kind: "diff",
						path: "repo:a.ts",
						line: 12,
						side: "new",
					},
					text: "line",
					comment: "comment",
				},
				"operator",
			),
		).toBe("Comment on `repo:a.ts:12`, operator:\n> line\ncomment");
		expect(
			quoteMarkdown(
				{
					source: {
						threadId: ID,
						kind: "diff",
						path: "repo:a.ts",
						line: 12,
						side: "old",
					},
					text: "line",
					comment: "comment",
				},
				"operator",
			),
		).toBe("Comment on `repo:a.ts:12` (a removed line), operator:\n> line\ncomment");
	});

	it("a paste folds past 2,000 characters or 40 lines", () => {
		expect(shouldFoldPaste("x".repeat(2000))).toBe(false);
		expect(shouldFoldPaste("x".repeat(2001))).toBe(true);
		expect(shouldFoldPaste("l\n".repeat(39))).toBe(false);
		expect(shouldFoldPaste("l\n".repeat(40))).toBe(true);
	});
});

describe("reference search input (#1024)", () => {
	it("`/` does, `@` mentions every record and monitoring item, `#` finds work items", () => {
		expect(TRIGGER_KINDS["/"]).toEqual(["command"]);
		expect(TRIGGER_KINDS["@"]).toEqual(
			expect.arrayContaining(["file", "thread", "incident", "schedule", "alert"]),
		);
		expect(TRIGGER_KINDS["#"]).toEqual(["thread", "message", "incident", "pull_request", "issue"]);
	});

	it("reads #123, !123 and a tracker key; words are not a number", () => {
		expect(referenceNumber("#123")).toEqual({ n: 123, mergeRequest: false });
		expect(referenceNumber("!7")).toEqual({ n: 7, mergeRequest: true });
		expect(referenceNumber("42")).toEqual({ n: 42, mergeRequest: false });
		expect(referenceNumber("pool 42")).toBeNull();
		expect(referenceKey("#PROJ-123")).toBe("PROJ-123");
		expect(referenceKey("proj-123")).toBeNull();
	});

	it("bounds the query and the limit", () => {
		expect(ReferenceSearchInputSchema.safeParse({ q: "x".repeat(201) }).success).toBe(
			false,
		);
		expect(ReferenceSearchInputSchema.safeParse({ limit: 51 }).success).toBe(false);
		expect(ReferenceSearchInputSchema.parse({})).toMatchObject({ q: "", limit: 20 });
	});
});

const KEY_ISSUE = String.raw`Invalid string: must match pattern /^[\w.-]{1,120}:\d{1,9}$/`;

describe("a message cited from another thread (#1195)", () => {
	const quote = (key: unknown, turn?: unknown) =>
		QuoteSchema.safeParse({
			source: { threadId: ID, kind: "transcript", key, turn },
			text: "pool exhausted",
		});

	it("a quote names its message by branch and sequence, and keeps the turn it sits in", () => {
		const ok = quote("main:12", 3);
		expect(ok.success && ok.data.source).toEqual({
			threadId: ID,
			kind: "transcript",
			key: "main:12",
			turn: 3,
		});
	});

	it.each([
		["no sequence", "main:"],
		["no branch", ":4"],
		["a space in the branch", "my branch:4"],
		["a sequence of ten digits", "main:1234567890"],
		["a non-numeric sequence", "main:x"],
	])("a quote refuses a key with %s, naming source.key", (_what, key) => {
		const r = quote(key);
		expect(r.success).toBe(false);
		expect(!r.success && r.error.issues.map((i) => [i.path.join("."), i.message])).toEqual([
			["source.key", KEY_ISSUE],
		]);
	});

	it("a quote refuses a turn below 1", () => {
		const r = quote("main:1", 0);
		expect(!r.success && r.error.issues.map((i) => [i.path.join("."), i.message])).toEqual([
			["source.turn", "Too small: expected number to be >=1"],
		]);
	});

	it("a message reference id round-trips its thread and key, and reads null when either part is malformed", () => {
		expect(parseMessageRefId(messageRefId(ID, "main:12"))).toEqual({ threadId: ID, key: "main:12" });
		expect(parseMessageRefId(`${ID}/main:`)).toBeNull();
		expect(parseMessageRefId(`not-a-uuid/main:12`)).toBeNull();
		expect(parseMessageRefId(ID)).toBeNull();
	});
});
