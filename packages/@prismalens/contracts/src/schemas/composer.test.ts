// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	ComposerDraftSchema,
	ComposerScopeSchema,
	PutDraftSchema,
	QuoteSchema,
	quoteMarkdown,
	scopeThreadId,
	shouldFoldPaste,
} from "./composer.js";
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
		expect(TRIGGER_KINDS["#"]).toEqual(["thread", "incident", "pull_request", "issue"]);
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
