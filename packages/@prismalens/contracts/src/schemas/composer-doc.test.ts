// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	chipText,
	docParts,
	docText,
	draftDoc,
	emptyDoc,
	isEmptyDoc,
	legacyDoc,
	sameDoc,
	textDoc,
} from "./composer-doc.js";
import {
	type ChipAttrs,
	type ComposerDoc,
	ComposerDocSchema,
	DRAFT_DOC_MAX_CHIPS,
	DRAFT_TEXT_MAX_CHARS,
	type Quote,
	type ReferenceRef,
} from "./composer.js";

const UUID = "6a3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("composer-doc schemas and utilities (#1101)", () => {
	describe("chipText", () => {
		it("chipText for ref with # kinds (pull_request, issue, thread, incident)", () => {
			const pr: ChipAttrs = {
				chip: "ref",
				ref: { kind: "pull_request", id: "101", label: "101" },
			};
			const issue: ChipAttrs = {
				chip: "ref",
				ref: { kind: "issue", id: "42", label: "42" },
			};
			const thread: ChipAttrs = {
				chip: "ref",
				ref: { kind: "thread", id: "th-1", label: "th-1" },
			};
			const incident: ChipAttrs = {
				chip: "ref",
				ref: { kind: "incident", id: "inc-1", label: "inc-1" },
			};

			expect(chipText(pr)).toBe("#101");
			expect(chipText(issue)).toBe("#42");
			expect(chipText(thread)).toBe("#th-1");
			expect(chipText(incident)).toBe("#inc-1");
		});

		it("chipText for ref with @ kinds", () => {
			const file: ChipAttrs = {
				chip: "ref",
				ref: { kind: "file", id: "f1", label: "main.ts" },
			};
			const service: ChipAttrs = {
				chip: "ref",
				ref: { kind: "service", id: "s1", label: "api" },
			};
			const project: ChipAttrs = {
				chip: "ref",
				ref: { kind: "project", id: "p1", label: "prismalens" },
			};
			const alert: ChipAttrs = {
				chip: "ref",
				ref: { kind: "alert", id: "a1", label: "cpu-high" },
			};

			expect(chipText(file)).toBe("@main.ts");
			expect(chipText(service)).toBe("@api");
			expect(chipText(project)).toBe("@prismalens");
			expect(chipText(alert)).toBe("@cpu-high");
		});

		it("chipText for ref with a label starting with #, @, or /", () => {
			const hashLabel: ChipAttrs = {
				chip: "ref",
				ref: { kind: "issue", id: "1", label: "#1" },
			};
			const atLabel: ChipAttrs = {
				chip: "ref",
				ref: { kind: "file", id: "2", label: "@f.ts" },
			};
			const slashLabel: ChipAttrs = {
				chip: "ref",
				ref: { kind: "command", id: "3", label: "/cmd" },
			};

			expect(chipText(hashLabel)).toBe("#1");
			expect(chipText(atLabel)).toBe("@f.ts");
			expect(chipText(slashLabel)).toBe("/cmd");
		});

		it("chipText for a url ref", () => {
			const urlRef: ChipAttrs = {
				chip: "ref",
				ref: { kind: "file", id: "link-1", label: "Docs" },
				url: "https://docs.prismalens.io",
			};
			expect(chipText(urlRef)).toBe("https://docs.prismalens.io");
		});

		it("chipText for command", () => {
			const cmd: ChipAttrs = {
				chip: "command",
				name: "investigate",
				source: "app",
				group: "Run",
			};
			expect(chipText(cmd)).toBe("/investigate");
		});

		it("chipText for quote", () => {
			const quote: ChipAttrs = {
				chip: "quote",
				quote: {
					source: { threadId: UUID, kind: "report" },
					text: "pool exhausted\nsecond line is cut",
				},
				cut: false,
			};
			expect(chipText(quote)).toBe("> pool exhausted");
		});

		it("chipText for file and pasted file", () => {
			const normalFile: ChipAttrs = {
				chip: "file",
				key: "k1",
				name: "diagram.png",
				type: "image/png",
				size: 1024,
			};
			const pastedFile: ChipAttrs = {
				chip: "file",
				key: "k2",
				name: "paste.txt",
				type: "text/plain",
				size: 2048,
				pasted: "SELECT * FROM users",
			};

			expect(chipText(normalFile)).toBe("[diagram.png]");
			expect(chipText(pastedFile)).toBe("SELECT * FROM users");
		});
	});

	describe("legacyDoc", () => {
		it("puts quote and ref chips first then a space then the text, one paragraph per line", () => {
			const quote: Quote = {
				source: { threadId: UUID, kind: "report" },
				text: "error message",
			};
			const ref: ReferenceRef = {
				kind: "issue",
				id: "99",
				label: "99",
			};

			const doc = legacyDoc({
				text: "first line\nsecond line",
				quotes: [quote],
				references: [ref],
			});

			expect(doc).toEqual({
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{
								type: "chip",
								attrs: { chip: "quote", quote, cut: false },
							},
							{
								type: "chip",
								attrs: { chip: "ref", ref },
							},
							{
								type: "text",
								text: " ",
							},
							{
								type: "text",
								text: "first line",
							},
						],
					},
					{
						type: "paragraph",
						content: [
							{
								type: "text",
								text: "second line",
							},
						],
					},
				],
			});
		});
	});

	describe("draftDoc", () => {
		it("prefers doc when present, falls back to legacyDoc when absent", () => {
			const explicitDoc = textDoc("explicit doc content");
			const withDoc = draftDoc({
				doc: explicitDoc,
				text: "legacy text",
				quotes: [],
				references: [],
			});
			expect(withDoc).toBe(explicitDoc);

			const withoutDoc = draftDoc({
				text: "plain text",
				quotes: [],
				references: [],
			});
			expect(withoutDoc).toEqual(
				legacyDoc({
					text: "plain text",
					quotes: [],
					references: [],
				}),
			);
		});
	});

	describe("docText", () => {
		it("serializes full document text with chips and hard breaks", () => {
			const doc: ComposerDoc = {
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{ type: "text", text: "Look at " },
							{
								type: "chip",
								attrs: {
									chip: "ref",
									ref: { kind: "file", id: "f1", label: "server.ts" },
								},
							},
							{ type: "hardBreak" },
							{ type: "text", text: "and report " },
							{
								type: "chip",
								attrs: {
									chip: "ref",
									ref: { kind: "issue", id: "10", label: "10" },
								},
							},
						],
					},
					{
						type: "paragraph",
						content: [{ type: "text", text: "second paragraph" }],
					},
				],
			};

			expect(docText(doc)).toBe(
				"Look at @server.ts\nand report #10\nsecond paragraph",
			);
		});
	});

	describe("docParts", () => {
		it("leading command chip becomes command and leaves the text, refs deduped by kind+id, quotes, files, trailing spaces trimmed", () => {
			const cmdAttrs: Extract<ChipAttrs, { chip: "command" }> = {
				chip: "command",
				name: "ask",
				source: "app",
				group: "General",
			};
			const ref1: ReferenceRef = { kind: "issue", id: "42", label: "42" };
			const refDuplicate: ReferenceRef = { kind: "issue", id: "42", label: "42" };
			const ref2: ReferenceRef = { kind: "file", id: "app.ts", label: "app.ts" };
			const quote: Quote = {
				source: { threadId: UUID, kind: "transcript" },
				text: "quoted line",
			};
			const fileAttrs: Extract<ChipAttrs, { chip: "file" }> = {
				chip: "file",
				key: "k1",
				name: "test.log",
				type: "text/plain",
				size: 100,
			};

			const doc: ComposerDoc = {
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{ type: "chip", attrs: cmdAttrs },
							{ type: "text", text: "  why did it fail?   " },
							{ type: "chip", attrs: { chip: "ref", ref: ref1 } },
							{ type: "text", text: " " },
							{ type: "chip", attrs: { chip: "ref", ref: refDuplicate } },
							{ type: "text", text: " " },
							{ type: "chip", attrs: { chip: "ref", ref: ref2 } },
							{ type: "chip", attrs: { chip: "quote", quote, cut: false } },
							{ type: "chip", attrs: fileAttrs },
						],
					},
				],
			};

			const parts = docParts(doc);
			expect(parts.command).toEqual(cmdAttrs);
			expect(parts.text).toBe("why did it fail?   #42 #42 @app.ts");
			expect(parts.references).toEqual([ref1, ref2]);
			expect(parts.quotes).toEqual([quote]);
			expect(parts.files).toEqual([fileAttrs]);
		});
	});

	describe("isEmptyDoc", () => {
		it("whitespace and hard breaks are empty, a chip is not", () => {
			expect(isEmptyDoc(emptyDoc())).toBe(true);
			expect(
				isEmptyDoc({
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "   \t  \n  " }],
						},
						{
							type: "paragraph",
							content: [{ type: "hardBreak" }],
						},
					],
				}),
			).toBe(true);

			expect(
				isEmptyDoc({
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: [
								{
									type: "chip",
									attrs: {
										chip: "ref",
										ref: { kind: "issue", id: "1", label: "1" },
									},
								},
							],
						},
					],
				}),
			).toBe(false);
		});
	});

	describe("sameDoc", () => {
		it("ignores null/absent attrs and key order but sees a changed label", () => {
			const docA: ComposerDoc = {
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{
								type: "chip",
								attrs: {
									chip: "ref",
									ref: { kind: "file", id: "f1", label: "same" },
									url: null,
									tone: "file",
								},
							},
						],
					},
				],
			};

			const docB: ComposerDoc = {
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{
								type: "chip",
								attrs: {
									tone: "file",
									ref: { label: "same", kind: "file", id: "f1" },
									chip: "ref",
								},
							},
						],
					},
				],
			};

			const docC: ComposerDoc = {
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{
								type: "chip",
								attrs: {
									chip: "ref",
									ref: { kind: "file", id: "f1", label: "different" },
									tone: "file",
								},
							},
						],
					},
				],
			};

			expect(sameDoc(docA, docB)).toBe(true);
			expect(sameDoc(docA, docC)).toBe(false);
		});
	});

	describe("ComposerDocSchema bounds", () => {
		it("refuses more than DRAFT_DOC_MAX_CHIPS chips and text over DRAFT_TEXT_MAX_CHARS", () => {
			const makeChips = (count: number): ComposerDoc => ({
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: Array.from({ length: count }, (_, i) => ({
							type: "chip" as const,
							attrs: {
								chip: "ref" as const,
								ref: { kind: "issue" as const, id: `${i}`, label: `${i}` },
							},
						})),
					},
				],
			});

			const docAtLimit = makeChips(DRAFT_DOC_MAX_CHIPS);
			const docOverLimit = makeChips(DRAFT_DOC_MAX_CHIPS + 1);

			expect(ComposerDocSchema.safeParse(docAtLimit).success).toBe(true);
			const chipOverParse = ComposerDocSchema.safeParse(docOverLimit);
			expect(chipOverParse.success).toBe(false);
			if (!chipOverParse.success) {
				expect(chipOverParse.error.issues[0]?.message).toBe(
					"Too many chips in one draft.",
				);
			}

			const makeTextDoc = (p1Len: number, p2Len: number): ComposerDoc => ({
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{
								type: "text",
								text: "x".repeat(p1Len),
							},
						],
					},
					{
						type: "paragraph",
						content: [
							{
								type: "text",
								text: "x".repeat(p2Len),
							},
						],
					},
				],
			});

			const textAtLimit = makeTextDoc(10000, DRAFT_TEXT_MAX_CHARS - 10000);
			const textOverLimit = makeTextDoc(10000, DRAFT_TEXT_MAX_CHARS - 10000 + 1);

			expect(ComposerDocSchema.safeParse(textAtLimit).success).toBe(true);
			const textOverParse = ComposerDocSchema.safeParse(textOverLimit);
			expect(textOverParse.success).toBe(false);
			if (!textOverParse.success) {
				expect(textOverParse.error.issues[0]?.message).toBe(
					"The draft's text is too long.",
				);
			}
		});
	});
});
